# Playback Level Meter Animation -- Implementation Plan

## Goal

Animate the `AudioLevelMeter` during audio playback so that it shows live amplitude levels matching the audio being played. Currently the meter freezes on the last microphone-captured values when playback begins. There are two distinct playback sources:

1. **Voice mirror playback** (`useVoiceMirror`) -- plays back from an in-memory `AudioBuffer` built from recorded PCM chunks.
2. **Recordings list playback** (`useRecordings`) -- plays back from a decoded `.m4a` file via `decodeAudioData`.

In both cases, the user should see the same animated level meter behavior: green bars pulsing in sync with the audio being played. The approach must be memory-efficient -- it must not load all audio samples into a separate buffer at once, but instead stream through the data chunk by chunk synchronized with playback time.

## Architecture / Approach

### Core idea: compute levels from the AudioBuffer on a timer during playback

Both playback paths already have an `AudioBuffer` available at play time:

- `useVoiceMirror.stopAndPlay()` builds one from `chunksRef.current` (line 257-262).
- `useRecordings.togglePlay()` gets one from `decoderService.decodeAudioData()` (line 119-127).

Rather than extracting all samples into a separate structure, we read small windows from the `AudioBuffer.getChannelData()` on a timer tick, compute RMS for each window, normalize it the same way the recording path does, and push it into `levelHistory`. The timer interval matches the recording callback's natural rate (~93ms per chunk at 4096 frames / 44100 Hz) to keep the visual appearance consistent.

### Memory-efficient streaming approach

`AudioBuffer.getChannelData(0)` returns a `Float32Array` view into the buffer's internal memory. We do NOT copy this into a second array. Instead, we keep a `playbackFrame` cursor that advances on each timer tick by `BUFFER_LENGTH` frames. On each tick:

1. Compute the current playback position from elapsed time since `source.start()`.
2. Read `BUFFER_LENGTH` samples from `getChannelData(0)` starting at that position.
3. Compute RMS and normalize identically to the recording path.
4. Push the normalized value into `levelHistory`.

This means we only touch `BUFFER_LENGTH` (4096) samples per tick -- the same working set as the recording path. No additional large allocations.

### Extracting a shared `computeNormalizedLevel` utility

The RMS + dB + normalization logic is currently inline in `useVoiceMirror`'s `onAudioReady` callback. We extract it into a pure function in `src/lib/audio.ts` so both hooks can use it:

```typescript
// src/lib/audio.ts

export function computeNormalizedLevel(
  samples: Float32Array,
  startFrame: number,
  numFrames: number,
): number {
  let sumSq = 0;
  const end = startFrame + numFrames;
  for (let i = startFrame; i < end; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / numFrames);
  const db = 20 * Math.log10(Math.max(rms, 1e-10));
  return Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
}
```

This function takes a `Float32Array`, a start offset, and a frame count, so it can operate on a slice of `getChannelData(0)` without copying.

### Adding a playback level meter helper: `usePlaybackLevelHistory`

Create a new hook `src/hooks/usePlaybackLevelHistory.ts` that encapsulates the timer-based level computation during playback. Both `useVoiceMirror` and `useRecordings` will use it.

```typescript
// src/hooks/usePlaybackLevelHistory.ts

import { useRef, useCallback } from 'react';
import type { AudioBuffer } from 'react-native-audio-api';
import { LEVEL_HISTORY_SIZE } from '../constants/audio';
import { computeNormalizedLevel } from '../lib/audio';

const PLAYBACK_TICK_MS = 93; // ~4096 frames at 44100 Hz
const FRAMES_PER_TICK = 4096;

type LevelHistorySetter = (updater: (prev: number[]) => number[]) => void;

export function usePlaybackLevelHistory() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPlaybackLevels = useCallback(
    (audioBuffer: AudioBuffer, startOffsetSec: number, setLevelHistory: LevelHistorySetter) => {
      stopPlaybackLevels();

      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const totalFrames = audioBuffer.length;
      const startFrame = Math.floor(startOffsetSec * sampleRate);
      const playbackStartTime = Date.now();

      timerRef.current = setInterval(() => {
        const elapsedMs = Date.now() - playbackStartTime;
        const currentFrame = startFrame + Math.floor((elapsedMs / 1000) * sampleRate);

        if (currentFrame >= totalFrames) {
          stopPlaybackLevels();
          return;
        }

        const framesToRead = Math.min(FRAMES_PER_TICK, totalFrames - currentFrame);
        const normalized = computeNormalizedLevel(channelData, currentFrame, framesToRead);
        setLevelHistory(prev => [...prev.slice(1), normalized]);
      }, PLAYBACK_TICK_MS);
    },
    [],
  );

  const stopPlaybackLevels = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { startPlaybackLevels, stopPlaybackLevels };
}
```

Key design decisions:
- Uses `setInterval` at ~93ms to match the recording callback frequency.
- Computes `currentFrame` from wall-clock elapsed time rather than incrementing a counter, so it stays synchronized with actual audio playback even if timer ticks are slightly irregular.
- Calls `stopPlaybackLevels` when the cursor reaches the end of the buffer (safety net -- normally the `onEnded` callback stops it first).
- `channelData` is a reference to the AudioBuffer's internal Float32Array -- no copy.

### Integrating into `useVoiceMirror`

In `useVoiceMirror.ts`, use `usePlaybackLevelHistory` and start it when playback begins in `stopAndPlay()`:

```typescript
// Inside useVoiceMirror, near the top:
const { startPlaybackLevels, stopPlaybackLevels } = usePlaybackLevelHistory();

// In stopAndPlay(), after playerNode.start(0, voiceStartSecs):
startPlaybackLevels(audioBuffer, voiceStartSecs, setLevelHistory);

// In playerNode.onEnded callback, before startMonitoring():
stopPlaybackLevels();

// In pauseMonitoring(), after stopping the player node:
stopPlaybackLevels();
```

The changes in `stopAndPlay()`:

```typescript
async function stopAndPlay() {
  // ... existing code to build audioBuffer ...

  const playerNode = context.createBufferSource();
  playerNodeRef.current = playerNode;
  playerNode.buffer = audioBuffer;
  playerNode.connect(context.destination);
  playerNode.onEnded = () => {
    playerNodeRef.current = null;
    stopPlaybackLevels();          // <-- new
    void startMonitoring();
  };
  playerNode.start(0, voiceStartSecs);
  startPlaybackLevels(audioBuffer, voiceStartSecs, setLevelHistory);  // <-- new
}
```

And in `pauseMonitoring()`:

```typescript
async function pauseMonitoring() {
  if (playerNodeRef.current) {
    playerNodeRef.current.onEnded = null;
    playerNodeRef.current.stop();
    playerNodeRef.current = null;
  }
  stopPlaybackLevels();            // <-- new
  // ... rest unchanged ...
}
```

And in `suspendForListPlayback()`:

```typescript
async function suspendForListPlayback() {
  // ... existing player node cleanup ...
  stopPlaybackLevels();            // <-- new
  // ... rest unchanged ...
}
```

### Integrating into `useRecordings`

`useRecordings` does not currently own a `levelHistory`. We add one, plus expose it in `RecordingsState`:

```typescript
// In useRecordings:
const [levelHistory, setLevelHistory] = useState<number[]>(
  () => new Array(LEVEL_HISTORY_SIZE).fill(0),
);
const { startPlaybackLevels, stopPlaybackLevels } = usePlaybackLevelHistory();
```

In `togglePlay`, after `source.start(0)`:

```typescript
source.start(0);
startPlaybackLevels(audioBuffer, 0, setLevelHistory);  // <-- new
```

In `stopCurrentPlayer`, stop the levels:

```typescript
const stopCurrentPlayer = useCallback((notify: boolean) => {
  if (sourceRef.current) {
    sourceRef.current.onEnded = null;
    sourceRef.current.stop();
    sourceRef.current = null;
    setPlayState(null);
    stopPlaybackLevels();           // <-- new
    setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0));  // <-- new: reset
  }
  if (notify) void options.onDidStop();
}, [options, stopPlaybackLevels]);
```

In the `onEnded` callback inside `togglePlay`:

```typescript
source.onEnded = () => {
  sourceRef.current = null;
  setPlayState(null);
  stopPlaybackLevels();             // <-- new
  setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0));  // <-- new: reset
  void options.onDidStop();
};
```

Update the return type and value:

```typescript
export type RecordingsState = {
  recordings: Recording[];
  playState: PlayState;
  levelHistory: number[];           // <-- new
  addRecording: (filePath: string, durationMs: number) => void;
  deleteRecording: (id: string) => void;
  togglePlay: (recording: Recording) => void;
};

return { recordings, playState, levelHistory, addRecording, deleteRecording, togglePlay };
```

### Switching level histories in VoiceMirrorScreen

The screen currently passes `levelHistory` from `useVoiceMirror` directly to `AudioLevelMeter`. We need to switch to the recordings' level history when a recording from the list is playing:

```typescript
// In VoiceMirrorContent:
const {
  recordings, playState, levelHistory: recordingsLevelHistory,
  addRecording, deleteRecording, togglePlay,
} = useRecordings(/* ... */);

// Determine which history to display:
const isListPlaying = playState?.isPlaying ?? false;
const activeLevelHistory = isListPlaying ? recordingsLevelHistory : levelHistory;

// Determine the visual phase for the meter:
const meterPhase = isListPlaying ? 'playing' as Phase : phase;
```

Then in the JSX:

```tsx
<AudioLevelMeter history={activeLevelHistory} phase={meterPhase} />
<PhaseDisplay phase={meterPhase} />
```

This ensures:
- During voice mirror operation (idle/recording/playing/paused), the meter shows levels from `useVoiceMirror`.
- During recordings list playback, the meter shows levels computed from the decoded audio file and displays in green ("playing" color).
- When list playback ends, it switches back to the voice mirror's level history.

### Cleanup on unmount

`usePlaybackLevelHistory` uses `useRef` for the timer. The hooks that use it (`useVoiceMirror`, `useRecordings`) already have cleanup in their `useEffect` returns that call `stop()` on audio nodes. We need to also call `stopPlaybackLevels()` in those cleanup paths. In `useRecordings`'s existing `useEffect` cleanup:

```typescript
useEffect(() => {
  repository.load().then(setRecordings);
  return () => {
    if (sourceRef.current) {
      sourceRef.current.onEnded = null;
      sourceRef.current.stop();
      sourceRef.current = null;
    }
    stopPlaybackLevels();           // <-- new
  };
}, [repository, stopPlaybackLevels]);
```

For `useVoiceMirror`, the existing `useEffect` cleanup already calls `clearOnAudioReady` and `stop` on the recorder. Add `stopPlaybackLevels()` there too:

```typescript
return () => {
  audioRecorderRef.current?.clearOnAudioReady();
  void audioRecorderRef.current?.stop();
  stopPlaybackLevels();             // <-- new
};
```

## File Paths That Need Modification

| File | Change |
|------|--------|
| `src/lib/audio.ts` | **New file**: `computeNormalizedLevel` function |
| `src/hooks/usePlaybackLevelHistory.ts` | **New file**: timer-based level history hook |
| `src/hooks/useVoiceMirror.ts` | Use `usePlaybackLevelHistory`; start/stop during playback; refactor inline RMS to use `computeNormalizedLevel` from `src/lib/audio.ts` |
| `src/hooks/useRecordings.ts` | Add `levelHistory` state; use `usePlaybackLevelHistory`; expose in return type |
| `src/screens/VoiceMirrorScreen.tsx` | Switch between voice mirror and recordings level histories; pass active history/phase to meter |
| `src/hooks/types.ts` | No changes needed (Phase type already covers 'playing') |
| `src/lib/__tests__/audio.test.ts` | **New file**: unit tests for `computeNormalizedLevel` |
| `src/hooks/__tests__/usePlaybackLevelHistory.test.ts` | **New file**: unit tests for the new hook |
| `src/hooks/__tests__/useVoiceMirror.test.ts` | Add tests for level history animation during playing phase |
| `src/hooks/__tests__/useRecordings.test.ts` | Add tests for `levelHistory` in `RecordingsState`; verify levels during playback |
| `src/__tests__/stubs/stubAudioDecoderService.ts` | Update `makeStubAudioBuffer` to return realistic `getChannelData` data for level testing |

## Considerations and Trade-offs

### Why `setInterval` instead of `requestAnimationFrame`?

`requestAnimationFrame` runs at display refresh rate (60-120 Hz), which is much faster than the ~10.7 Hz rate of the recording path's audio callbacks. Using it would mean either:
- Computing levels 6-12x more often than during recording (inconsistent visual density), or
- Adding frame-skip logic to throttle to ~93ms intervals.

`setInterval` at 93ms directly matches the recording callback's cadence, producing the same visual rhythm. The meter displays 40 bars representing ~3.7 seconds of history -- this stays consistent between recording and playback.

### Why not use an AnalyserNode?

`react-native-audio-api` does provide `AnalyserNode`, which could tap into the audio graph during playback. However:
- It would require restructuring the audio graph (connecting the source through an analyser before the destination).
- The analyser's FFT-based frequency data would need conversion to match the time-domain RMS approach used during recording.
- The existing `AudioBuffer.getChannelData()` approach is simpler, produces identical results to the recording path, and works without modifying the audio playback graph.

### Memory efficiency

The `getChannelData(0)` call returns a typed array view -- it does not copy the underlying buffer data. The per-tick computation touches only 4096 samples (16 KB of float data). The `setInterval` callback closure holds a reference to the `Float32Array` view, but this is the same data the `AudioBufferSourceNode` is already using for playback, so no additional memory is allocated.

For `useRecordings`, the `AudioBuffer` returned by `decodeAudioData` is already in memory for playback. We merely read from it during the playback timer -- no duplication.

### Timer drift and synchronization

Using `Date.now()` elapsed time to compute the current frame position means the level display tracks real playback time even if `setInterval` fires slightly early or late. This is important because `setInterval` is not perfectly precise, but the level visualization needs to stay roughly in sync with what the user hears.

### Phase display during list playback

Currently `PhaseDisplay` shows the voice mirror's phase. During list playback, `suspendForListPlayback` sets phase to `'idle'`, which would show the idle (blue) pulsing dot while green playing bars are shown. The plan addresses this by computing a `meterPhase` that is `'playing'` when a recording from the list is playing. This is passed to both `AudioLevelMeter` and `PhaseDisplay` so they show consistent "playing" visuals.

### The `usePlaybackLevelHistory` hook returning stable references

The `startPlaybackLevels` and `stopPlaybackLevels` callbacks are wrapped in `useCallback` with empty dependency arrays, so they are stable across renders. This matters because `stopPlaybackLevels` is added to the dependency array of `stopCurrentPlayer` in `useRecordings` -- if it were unstable, it would cause cascading re-creations of all the callbacks that depend on `stopCurrentPlayer`.

### Resetting level history after list playback stops

When list playback stops (either naturally via `onEnded` or by user action via `stopCurrentPlayer`), the recordings level history is reset to all zeros. This ensures that when the screen switches back to showing `useVoiceMirror`'s level history, there is no stale data flash if the user later starts another list playback.

## Todo

### Phase 1: Extract shared level computation utility

- [x] Create `src/lib/audio.ts` with `computeNormalizedLevel(samples, startFrame, numFrames)` function
- [x] Move `DB_FLOOR` and `DB_CEIL` constants from `src/constants/audio.ts` (or `src/hooks/useVoiceMirror.ts`) into `src/lib/audio.ts` (or re-export them so both locations can use them)
- [x] Create `src/lib/__tests__/audio.test.ts` with unit tests for `computeNormalizedLevel`:
  - [x] Test that silence (all zeros) returns 0
  - [x] Test that full-scale signal (all 1.0) returns 1
  - [x] Test that intermediate amplitude returns a value between 0 and 1
  - [x] Test that startFrame/numFrames windowing works correctly (only reads the specified slice)
  - [x] Test clamping: values below DB_FLOOR map to 0, values above DB_CEIL map to 1

### Phase 2: Create `usePlaybackLevelHistory` hook

- [x] Create `src/hooks/usePlaybackLevelHistory.ts` with the hook implementation
- [x] Implement `startPlaybackLevels(audioBuffer, startOffsetSec, setLevelHistory)` using `setInterval` at ~93ms
- [x] Implement `stopPlaybackLevels()` to clear the interval timer
- [x] Ensure `startPlaybackLevels` calls `stopPlaybackLevels` first (prevent double timers)
- [x] Ensure auto-stop when currentFrame exceeds totalFrames
- [x] Wrap both callbacks in `useCallback` with empty dependency arrays for stable references
- [x] Create `src/hooks/__tests__/usePlaybackLevelHistory.test.ts` with unit tests:
  - [x] Test that `startPlaybackLevels` begins pushing values into levelHistory via the setter
  - [x] Test that `stopPlaybackLevels` stops the timer (no further updates)
  - [x] Test that calling `startPlaybackLevels` twice stops the first timer before starting a new one
  - [x] Test that the timer auto-stops when reaching the end of the audio buffer

### Phase 3: Integrate into `useVoiceMirror`

- [x] Import and call `usePlaybackLevelHistory` at the top of `useVoiceMirror`
- [x] Refactor inline RMS/dB/normalization logic in `onAudioReady` callback to use `computeNormalizedLevel`
- [x] In `stopAndPlay()`: call `startPlaybackLevels(audioBuffer, voiceStartSecs, setLevelHistory)` after `playerNode.start()`
- [x] In `playerNode.onEnded` callback: call `stopPlaybackLevels()` before `startMonitoring()`
- [x] In `pauseMonitoring()`: call `stopPlaybackLevels()` after stopping the player node
- [x] In `suspendForListPlayback()`: call `stopPlaybackLevels()` during cleanup
- [x] In the `useEffect` cleanup return: call `stopPlaybackLevels()`
- [x] Update `src/hooks/__tests__/useVoiceMirror.test.ts`:
  - [x] Add test that levelHistory updates during the playing phase (after stopAndPlay)
  - [x] Add test that levelHistory stops updating after playback ends

### Phase 4: Integrate into `useRecordings`

- [x] Add `levelHistory` state with `useState<number[]>(() => new Array(LEVEL_HISTORY_SIZE).fill(0))`
- [x] Import and call `usePlaybackLevelHistory` in `useRecordings`
- [x] In `togglePlay()`: call `startPlaybackLevels(audioBuffer, 0, setLevelHistory)` after `source.start(0)`
- [x] In `stopCurrentPlayer()`: call `stopPlaybackLevels()` and reset `levelHistory` to zeros
- [x] In `source.onEnded` callback: call `stopPlaybackLevels()` and reset `levelHistory` to zeros
- [x] In `useEffect` cleanup: call `stopPlaybackLevels()`
- [x] Update `RecordingsState` type to include `levelHistory: number[]`
- [x] Return `levelHistory` from the hook
- [x] Update `src/__tests__/stubs/stubAudioDecoderService.ts`: make `makeStubAudioBuffer` return realistic `getChannelData` data (non-zero Float32Array) for level testing
- [x] Update `src/hooks/__tests__/useRecordings.test.ts`:
  - [x] Add test that `levelHistory` is exposed in the hook return value
  - [x] Add test that `levelHistory` updates during playback
  - [x] Add test that `levelHistory` resets to zeros when playback stops
  - [x] Add test that `levelHistory` resets to zeros when playback ends naturally (onEnded)

### Phase 5: Switch level histories in VoiceMirrorScreen

- [x] Destructure `levelHistory: recordingsLevelHistory` from `useRecordings` in `VoiceMirrorContent`
- [x] Compute `isListPlaying` from `playState?.isPlaying`
- [x] Compute `activeLevelHistory`: use `recordingsLevelHistory` when `isListPlaying`, otherwise `levelHistory` from `useVoiceMirror`
- [x] Compute `meterPhase`: use `'playing'` when `isListPlaying`, otherwise the voice mirror's `phase`
- [x] Pass `activeLevelHistory` to `AudioLevelMeter`'s `history` prop
- [x] Pass `meterPhase` to both `AudioLevelMeter` and `PhaseDisplay`

### Phase 6: Verification

- [x] Run `pnpm typecheck` and fix any type errors
- [x] Run `pnpm lint` and fix any lint issues
- [x] Run `pnpm test:ci` and ensure all tests pass (existing + new)
- [ ] Manual smoke test: verify level meter animates during voice mirror playback
- [ ] Manual smoke test: verify level meter animates during recordings list playback
- [ ] Manual smoke test: verify meter switches back to voice mirror levels after list playback ends
- [ ] Manual smoke test: verify pausing voice mirror stops the playback level animation
