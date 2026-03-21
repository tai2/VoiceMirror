# Fix Conflicting Audio Playback — Implementation Plan

**Date:** 2026-03-21
**Branch:** `fix-conflicting-audio-playback`

## Problem Statement

When a user plays a recording from the history list, the microphone remains active. The speaker output gets picked up by the mic, triggering voice-onset detection and potentially starting a new recording cycle mid-playback. Root causes:

1. `useRecordings` uses `expo-audio` (`createAudioPlayer`), which is completely decoupled from `useVoiceMirror`'s `AudioContext` and recorder.
2. There is no coordination: when list playback starts, the voice mirror recorder is never stopped.
3. Two independent audio subsystems (`expo-audio` + `react-native-audio-api`) share the iOS audio session with no arbitration.

## Goals

1. Ensure `idle` and `recording` phases are mutually exclusive with any audio playback (voice mirror or list).
2. Replace `expo-audio` playback in `useRecordings` with `react-native-audio-api`, unifying under one audio subsystem.
3. Correctly restore monitoring state when list playback ends, respecting whether the user had manually paused.

---

## Architecture Changes

### New shared `AudioContext` provider

Currently, `AudioContext` is created privately inside `useVoiceMirror`. Both hooks need access to the same instance. We lift it into a React context.

**New file: `src/context/AudioContextProvider.tsx`**

```tsx
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AudioContext } from 'react-native-audio-api';
import { SAMPLE_RATE } from '../constants/audio';

const Ctx = createContext<AudioContext | null>(null);

export function AudioContextProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<AudioContext | null>(null);

  useEffect(() => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    setCtx(context);
    return () => { void context.close(); };
  }, []);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useAudioContext(): AudioContext | null {
  return useContext(Ctx);
}
```

`SAMPLE_RATE` (`44100`) moves to `src/constants/audio.ts` (currently only defined locally in `useVoiceMirror`).

---

### Changes to `useVoiceMirror`

#### Remove internal `AudioContext` creation

Replace the internal `new AudioContext(...)` with `useAudioContext()`. The hook waits for `ctx` to be non-null before setting up:

```ts
const ctx = useAudioContext();

useEffect(() => {
  if (!ctx) return;
  // existing permission + setup logic, with ctx from provider
  (async () => {
    const status = await AudioManager.requestRecordingPermissions();
    // ...
    audioContextRef.current = ctx;
    audioRecorderRef.current = new AudioRecorder();
    await startMonitoring();
  })();

  return () => {
    audioRecorderRef.current?.clearOnAudioReady();
    void audioRecorderRef.current?.stop();
    // NOTE: do NOT close ctx here — the provider owns its lifecycle
  };
}, [ctx]);
```

#### Add `suspendForListPlayback` / `resumeFromListPlayback`

These are separate from user-initiated `togglePause` so that a manual pause is not silently overridden.

A new ref tracks whether the hook was already in the user-paused state when external playback started:

```ts
const wasUserPausedRef = useRef(false);
```

```ts
async function suspendForListPlayback() {
  wasUserPausedRef.current = phaseRef.current === 'paused';

  // Stop voice-mirror playback if it happens to be in 'playing' phase
  if (playerNodeRef.current) {
    playerNodeRef.current.onEnded = null;
    playerNodeRef.current.stop();
    playerNodeRef.current = null;
  }

  if (phaseRef.current !== 'paused') {
    // Stop recorder but do NOT call setAudioSessionActivity(false):
    // the audio session must remain active for list playback that follows.
    audioRecorderRef.current?.clearOnAudioReady();
    await audioRecorderRef.current?.stop();
    phaseRef.current = 'idle';
    setPhase('idle');
  }
}

async function resumeFromListPlayback() {
  if (wasUserPausedRef.current) {
    // User had paused manually — restore that state, do not restart mic
    phaseRef.current = 'paused';
    setPhase('paused');
    await AudioManager.setAudioSessionActivity(false);
  } else {
    await startMonitoring();
  }
}
```

#### Updated return type

```ts
// src/hooks/types.ts
export type VoiceMirrorState = {
  phase: Phase;
  levelHistory: number[];
  hasPermission: boolean;
  permissionDenied: boolean;
  recordingError: string | null;
  togglePause: () => void;
  suspendForListPlayback: () => Promise<void>;
  resumeFromListPlayback: () => Promise<void>;
};
```

---

### Changes to `useRecordings`

#### Remove `expo-audio`, replace with `decodeAudioData` + `BufferSourceNode`

**New imports:**

```ts
import { decodeAudioData } from 'react-native-audio-api';
import type { AudioBufferSourceNode } from 'react-native-audio-api';
import { useAudioContext } from '../context/AudioContextProvider';
```

**Drop:**
```ts
// REMOVE:
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
```

#### New hook signature

The hook accepts `onWillPlay` / `onDidStop` callbacks so the screen can wire up monitoring suspension:

```ts
type RecordingsOptions = {
  onWillPlay: () => Promise<void>;
  onDidStop: () => Promise<void>;
};

export function useRecordings(options: RecordingsOptions): RecordingsState { ... }
```

#### New playback state

Replace `AudioPlayer` ref with `AudioBufferSourceNode` ref:

```ts
const sourceRef = useRef<AudioBufferSourceNode | null>(null);
const isDecodingRef = useRef(false);  // guard against concurrent decode calls
```

#### `stopCurrentPlayer` — stops any active source node

```ts
const stopCurrentPlayer = useCallback((notify: boolean) => {
  if (sourceRef.current) {
    sourceRef.current.onEnded = null;  // prevent double-callback
    sourceRef.current.stop();
    sourceRef.current = null;
    setPlayState(null);
  }
  if (notify) void options.onDidStop();
}, [options.onDidStop]);
```

The `notify` flag distinguishes "user stopped explicitly" (should resume monitoring) from "stopping to immediately start another track" (monitoring stays suspended).

#### `togglePlay` — async decode + play

```ts
const togglePlay = useCallback(async (recording: Recording) => {
  const ctx = audioContext;
  if (!ctx) return;

  // Tapping the currently-playing recording stops it
  if (playState?.recordingId === recording.id && playState.isPlaying) {
    stopCurrentPlayer(true);
    return;
  }

  // Guard: ignore tap while a decode is already in flight
  if (isDecodingRef.current) return;

  const wasAlreadyPlaying = sourceRef.current !== null;

  // Stop any existing playback; if switching tracks, keep monitoring suspended
  stopCurrentPlayer(false);

  if (!wasAlreadyPlaying) {
    await options.onWillPlay();
  }

  setPlayState({ recordingId: recording.id, isPlaying: true });

  isDecodingRef.current = true;
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await decodeAudioData(recording.filePath, { sampleRate: ctx.sampleRate });
  } catch (e) {
    console.error('[useRecordings] decodeAudioData failed:', e);
    isDecodingRef.current = false;
    setPlayState(null);
    await options.onDidStop();
    return;
  }
  isDecodingRef.current = false;

  const source = ctx.createBufferSource();
  sourceRef.current = source;
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  source.onEnded = () => {
    sourceRef.current = null;
    setPlayState(null);
    void options.onDidStop();
  };
  source.start(0);
}, [playState, audioContext, stopCurrentPlayer, options]);
```

**Note on `decodeAudioData` options:**
- Pass `{ sampleRate: ctx.sampleRate }` so the decoded buffer matches the context's sample rate (44 100 Hz), avoiding resampling artefacts.
- The input can be a `file://` URI string directly — no manual `fetch` needed.
- m4a is supported via FFmpeg on mobile (already confirmed in docs).

#### Cleanup on unmount

```ts
useEffect(() => {
  return () => {
    if (sourceRef.current) {
      sourceRef.current.onEnded = null;
      sourceRef.current.stop();
      sourceRef.current = null;
    }
  };
}, []);
```

---

### Changes to `VoiceMirrorScreen`

Wrap with `AudioContextProvider` and wire the suspension callbacks:

```tsx
import { AudioContextProvider } from '../context/AudioContextProvider';

export function VoiceMirrorScreen() {
  return (
    <AudioContextProvider>
      <VoiceMirrorContent />
    </AudioContextProvider>
  );
}

function VoiceMirrorContent() {
  const {
    phase, levelHistory, hasPermission, permissionDenied, recordingError,
    togglePause, suspendForListPlayback, resumeFromListPlayback,
  } = useVoiceMirror(addRecording);

  const { recordings, playState, addRecording, togglePlay } = useRecordings({
    onWillPlay: suspendForListPlayback,
    onDidStop: resumeFromListPlayback,
  });

  // ... rest of render unchanged
}
```

> **Note:** `addRecording` is used by both hooks, so extraction into `VoiceMirrorContent` keeps the dependency order clean. Alternatively, keep `VoiceMirrorScreen` as a single component and hoist `addRecording` via `useCallback` before it is passed to `useVoiceMirror`.

### Disable list play buttons during `'recording'`

`phase` is already available in `VoiceMirrorScreen`. Pass it down as a `disabled` prop:

**`VoiceMirrorScreen`** — add `disabled` prop to `RecordingsList`:

```tsx
<RecordingsList
  recordings={recordings}
  playState={playState}
  onTogglePlay={togglePlay}
  disabled={phase === 'recording'}
/>
```

**`RecordingsList`** — accept and forward `disabled`:

```tsx
type Props = {
  recordings: Recording[];
  playState: PlayState;
  onTogglePlay: (r: Recording) => void;
  disabled: boolean;
};

// Pass disabled to each RecordingItem
renderItem={({ item }) => (
  <RecordingItem
    recording={item}
    playState={playState}
    onTogglePlay={() => onTogglePlay(item)}
    disabled={disabled}
  />
)}
```

**`RecordingItem`** — apply `disabled` to the play `Pressable`:

```tsx
type Props = {
  recording: Recording;
  playState: PlayState;
  onTogglePlay: () => void;
  disabled: boolean;
};

<Pressable onPress={onTogglePlay} disabled={disabled} style={[styles.playButton, disabled && styles.playButtonDisabled]}>
  ...
</Pressable>
```

No change is needed in `useRecordings` or `suspendForListPlayback` — the disabled state is enforced purely at the UI layer.

---

### Remove `expo-audio`

```bash
pnpm remove expo-audio
```

Verify no other imports remain:
```bash
grep -r 'expo-audio' src/
```

---

## Sequence Diagram: List Playback Flow

```
User taps recording
        │
        ▼
togglePlay(recording)
        │
        ├─ [if already playing same] stopCurrentPlayer(notify=true) → onDidStop → resumeFromListPlayback
        │
        ├─ stopCurrentPlayer(notify=false)   ← no callback; stay suspended
        ├─ [if first play] onWillPlay()
        │       │
        │       └─ suspendForListPlayback()
        │               ├─ save wasUserPaused
        │               ├─ stop BufferSourceNode if 'playing'
        │               └─ stop recorder (session stays active)
        │
        ├─ decodeAudioData(filePath) → AudioBuffer
        │
        ├─ createBufferSource → connect → start
        │
        └─ onEnded fires
                │
                └─ onDidStop()
                        │
                        └─ resumeFromListPlayback()
                                ├─ [wasUserPaused] → restore 'paused', deactivate session
                                └─ [else] startMonitoring() → 'idle'
```

## Sequence Diagram: Voice Mirror During List Playback

```
Voice mirror in 'playing' phase, user taps a list recording:
        │
        ▼
suspendForListPlayback()
        ├─ playerNodeRef.current.stop() + onEnded = null  ← prevents startMonitoring() from firing
        └─ recorder already stopped (we're in 'playing' phase)
```

This correctly prevents the `onEnded → startMonitoring()` cascade from firing while list playback takes over.

---

## Edge Cases

| Scenario | Handled by |
|---|---|
| User pauses, then plays list item | `wasUserPausedRef` → monitoring stays paused after list item ends |
| Tap different recording while one is playing | `stopCurrentPlayer(notify=false)` → no resume/re-suspend cycle; stays suspended |
| Decode takes long, user taps again | `isDecodingRef` guard → second tap is a no-op |
| Decode fails | Error logged, `setPlayState(null)`, `onDidStop()` restores monitoring |
| Voice mirror in `'recording'` phase when user taps list item | Not possible — list play buttons are disabled during `'recording'` |

---

## Todo

### Phase 1 — Shared infrastructure

- [x] Add `export const SAMPLE_RATE = 44100` to `src/constants/audio.ts`
- [x] Create `src/context/AudioContextProvider.tsx` with `AudioContextProvider` component and `useAudioContext()` hook

### Phase 2 — `useVoiceMirror` refactor

- [x] Call `useAudioContext()` at the top of the hook; store result in a local `ctx` variable
- [x] Replace `new AudioContext(...)` creation inside `useEffect` with `audioContextRef.current = ctx`
- [x] Add `if (!ctx) return;` guard at the top of the `useEffect` so setup waits for the provider
- [x] Remove `void audioContextRef.current?.close()` from the `useEffect` cleanup (provider owns lifecycle)
- [x] Add `wasUserPausedRef = useRef(false)` ref
- [x] Implement `suspendForListPlayback()`: save `wasUserPaused`, stop `playerNodeRef` if set (clear `onEnded` first), stop recorder without deactivating the audio session if not already paused
- [x] Implement `resumeFromListPlayback()`: if `wasUserPaused` → restore paused state + deactivate session; else → call `startMonitoring()`
- [x] Add `suspendForListPlayback` and `resumeFromListPlayback` to the hook's return value

### Phase 3 — `types.ts` update

- [x] Add `suspendForListPlayback: () => Promise<void>` to `VoiceMirrorState`
- [x] Add `resumeFromListPlayback: () => Promise<void>` to `VoiceMirrorState`

### Phase 4 — `useRecordings` refactor

- [x] Remove `import { createAudioPlayer, AudioPlayer } from 'expo-audio'`
- [x] Add imports: `decodeAudioData`, `AudioBufferSourceNode` from `react-native-audio-api`; `useAudioContext` from the new provider
- [x] Call `useAudioContext()` inside the hook
- [x] Replace `playerRef: useRef<AudioPlayer>` with `sourceRef: useRef<AudioBufferSourceNode | null>(null)`
- [x] Add `isDecodingRef = useRef(false)` guard ref
- [x] Define `RecordingsOptions` type (`onWillPlay`, `onDidStop`) and update the hook signature to accept it
- [x] Rewrite `stopCurrentPlayer(notify: boolean)`: clear `onEnded`, call `.stop()` on `sourceRef`, nullify ref, `setPlayState(null)`, call `onDidStop()` only when `notify` is true
- [x] Rewrite `togglePlay` as async:
  - [x] Return early if `ctx` is null
  - [x] If tapping the currently-playing item → `stopCurrentPlayer(true)` and return
  - [x] Return early if `isDecodingRef.current` is true
  - [x] Record `wasAlreadyPlaying = sourceRef.current !== null`
  - [x] Call `stopCurrentPlayer(false)` to stop any existing playback without resuming monitoring
  - [x] Call `onWillPlay()` only if `!wasAlreadyPlaying`
  - [x] Set `playState` optimistically
  - [x] Set `isDecodingRef.current = true`, call `decodeAudioData(recording.filePath, ctx.sampleRate)`
  - [x] On decode error: log, clear `isDecodingRef`, clear `playState`, call `onDidStop()`, return
  - [x] Set `isDecodingRef.current = false`, create `BufferSourceNode`, connect, set `onEnded` to clear ref + `playState` + call `onDidStop()`, call `source.start(0)`
- [x] Update `useEffect` cleanup: null out `onEnded` and call `.stop()` on `sourceRef` if set (do not call `onDidStop` on unmount)
- [x] Remove the `useEffect` that called `playerRef.current?.remove()` on unmount (replaced by above)

### Phase 5 — `VoiceMirrorScreen` wiring

- [x] Split into `VoiceMirrorScreen` (provider wrapper) and `VoiceMirrorContent` (logic + render), or hoist `addRecording` with `useCallback` so it can be passed to `useVoiceMirror` before `useRecordings` is called
- [x] Wrap the screen's return with `<AudioContextProvider>`
- [x] Destructure `suspendForListPlayback` and `resumeFromListPlayback` from `useVoiceMirror`
- [x] Pass `{ onWillPlay: suspendForListPlayback, onDidStop: resumeFromListPlayback }` to `useRecordings`
- [x] Pass `disabled={phase === 'recording'}` to `<RecordingsList>`

### Phase 6 — UI: disable play buttons during recording

- [x] Add `disabled: boolean` to `RecordingsList` props type and forward it to each `<RecordingItem>`
- [x] Add `disabled: boolean` to `RecordingItem` props type
- [x] Pass `disabled={disabled}` to the play `Pressable` in `RecordingItem`
- [x] Add a `playButtonDisabled` style (e.g. reduced opacity) for visual feedback

### Phase 7 — Remove `expo-audio`

- [x] Run `pnpm remove expo-audio`
- [x] Confirm no remaining `expo-audio` imports with `grep -r 'expo-audio' src/`

### Phase 8 — Verification

- [x] Run `pnpm run typecheck` — no TypeScript errors
- [ ] Manual test: speak → recording plays back → monitoring resumes automatically
- [ ] Manual test: tap a list recording → mic stops → playback completes → mic restarts
- [ ] Manual test: pause mirror → tap a list recording → playback completes → mirror stays paused
- [ ] Manual test: tap a different list recording while one is playing → first stops, second starts, no double-resume of mic
- [ ] Manual test: tap same recording while playing → playback stops, mic restarts
- [ ] Manual test: speak while list recording is playing — confirm mic is off (no new recording triggered)

---

## Files Changed Summary

| File | Change |
|---|---|
| `src/context/AudioContextProvider.tsx` | **New** — shared AudioContext provider |
| `src/constants/audio.ts` | Add `export const SAMPLE_RATE = 44100` |
| `src/hooks/types.ts` | Add `suspendForListPlayback`, `resumeFromListPlayback` to `VoiceMirrorState` |
| `src/hooks/useVoiceMirror.ts` | Use `useAudioContext()`, add suspend/resume, remove `AudioContext` creation |
| `src/hooks/useRecordings.ts` | Replace `expo-audio` with `decodeAudioData`+`BufferSourceNode`, accept callbacks |
| `src/screens/VoiceMirrorScreen.tsx` | Wrap with provider, wire suspension callbacks, pass `disabled={phase === 'recording'}` |
| `src/components/RecordingsList.tsx` | Accept and forward `disabled` prop |
| `src/components/RecordingItem.tsx` | Apply `disabled` to play `Pressable` |
| `package.json` | Remove `expo-audio` |
