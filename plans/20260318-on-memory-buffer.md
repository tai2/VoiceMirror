# On-Memory Audio Buffer — Implementation Plan

*2026-03-18*

---

## 1. Goal

Replace `expo-audio` with `react-native-audio-api` and eliminate all file I/O from the record-and-replay loop. Audio captured from the microphone is accumulated in memory as raw PCM `Float32Array` chunks and played back directly via `AudioBufferSourceNode` — no temporary files, no seek delays.

The state machine, threshold constants, UI components, and overall UX remain identical to the MVP. Only `useVoiceMirror.ts`, `app.json`, and the dependency list change.

---

## 2. Why On-Memory

| Concern | expo-audio (file) | react-native-audio-api (memory) |
|---|---|---|
| Playback latency | Must flush file to disk before play | Immediate — buffer is already in RAM |
| Disk accumulation | `.m4a` file per take, never cleaned up | No files ever written |
| Pre-speech trim | Seek via `player.seekTo(voiceStartSecs)` | Offset param in `playerNode.start()` |
| Metering granularity | 100 ms poll via hook | Per-chunk (~93 ms), driven by audio hardware |
| API coupling | Expo-proprietary hooks | Web Audio API — portable, well-documented |

---

## 3. Architecture Overview

```
AudioRecorder (native mic)
  │
  └─ onAudioReady callback (fires every ~93 ms)
       ├─ copy chunk into Float32Array, push to chunksRef
       ├─ totalFramesRef += numFrames   (absolute; never decremented)
       ├─ bufferedFramesRef += numFrames
       ├─ if IDLE && no voice candidate → trim oldest chunks to MAX_IDLE_BUFFER_SECS
       ├─ compute RMS dB from chunk
       ├─ run voice/silence state machine
       └─ call setPhase / setLevelHistory (React state)

On silence confirmed:
  ├─ clearOnAudioReady + recorder.stop()
  ├─ merge chunksRef → single AudioBuffer
  ├─ create AudioBufferSourceNode
  ├─ node.onLoopEnded = restartMonitoring
  └─ node.start(ctx.currentTime, voiceStartSecs)   ← skips pre-speech silence

restartMonitoring():
  ├─ reset all refs
  ├─ recorder.start() + onAudioReady(...)
  └─ setPhase('idle')
```

### Audio graph

There is no connected audio graph needed for the recording phase — metering is computed directly from the PCM data arriving in `onAudioReady`. The graph is minimal:

```
AudioBufferSourceNode → AudioContext.destination   (playback only)
```

---

## 4. Package Changes

### Remove

```bash
pnpm remove expo-audio
```

### Add

```bash
npx expo install react-native-audio-api
```

`react-native-audio-api` ships a native module. A new development build is required after installation (same requirement as the original `expo-audio` installation).

---

## 5. `app.json` Changes

Replace the bare `ios.infoPlist` microphone string and `android.permissions` array with the `react-native-audio-api` Expo plugin, which injects them automatically:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-audio-api",
        {
          "iosMicrophonePermission": "VoiceMirror records your voice so you can immediately hear yourself back.",
          "androidPermissions": ["android.permission.RECORD_AUDIO"]
        }
      ]
    ]
  }
}
```

Remove the now-redundant fields:
- `ios.infoPlist.NSMicrophoneUsageDescription` (handled by the plugin)
- `android.permissions` array (handled by the plugin)

---

## 6. Recording: `onAudioReady` Accumulation

### Initialization (once on mount)

```typescript
import { AudioContext, AudioRecorder, AudioManager } from 'react-native-audio-api';

const SAMPLE_RATE = 44100;
const BUFFER_LENGTH = 4096;   // ~93 ms per chunk at 44100 Hz
const CHANNEL_COUNT = 1;      // mono

const audioContextRef = useRef<AudioContext | null>(null);
const audioRecorderRef = useRef<AudioRecorder | null>(null);

// In the permission effect:
audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
audioRecorderRef.current = new AudioRecorder();
```

> **Note:** Read `audioContextRef.current.sampleRate` after construction — the OS may negotiate a rate different from the requested one. Use that value everywhere instead of the hardcoded constant.

### Refs for accumulated audio

```typescript
const chunksRef = useRef<Float32Array[]>([]);
const totalFramesRef = useRef<number>(0);    // absolute frames since startMonitoring — never decremented
const bufferedFramesRef = useRef<number>(0); // frames currently held in chunksRef
const voiceStartFrameRef = useRef<number>(0); // absolute frame index at voice onset
```

`totalFramesRef` is the single source of truth for timing in the state machine. `bufferedFramesRef` tracks how much audio is actually in memory so the rolling window can evict oldest chunks.

### Rolling idle buffer

The app can sit in IDLE indefinitely. Without a cap, `chunksRef` grows by ~1.76 MB every 10 seconds. A rolling window is enforced: only trim when the phase is `idle` **and no voice candidate is pending** (`voiceStartTimeRef.current === null`). Once potential voice is detected, trimming stops immediately so the onset chunk is never evicted during the 250 ms confirmation window.

```typescript
const MAX_IDLE_BUFFER_SECS = 30; // keep at most 30 s of audio while in IDLE
```

At 44100 Hz mono 32-bit float: `30 × 44100 × 4 = ~5.3 MB` ceiling while idle.

### Starting a monitoring cycle

```typescript
async function startMonitoring() {
  const ctx = audioContextRef.current!;
  const recorder = audioRecorderRef.current!;

  // Reset accumulation
  chunksRef.current = [];
  totalFramesRef.current = 0;
  bufferedFramesRef.current = 0;
  voiceStartTimeRef.current = null;
  silenceStartTimeRef.current = null;
  voiceStartFrameRef.current = 0;
  phaseRef.current = 'idle';

  await AudioManager.setAudioSessionActivity(true);
  await recorder.start();

  recorder.onAudioReady(
    { sampleRate: ctx.sampleRate, bufferLength: BUFFER_LENGTH, channelCount: CHANNEL_COUNT },
    ({ buffer, numFrames }) => {
      // 1. Copy valid samples out of the AudioBuffer.
      //    copyFromChannel copies exactly destination.length frames, so
      //    allocating numFrames handles partial trailing chunks automatically.
      const chunk = new Float32Array(numFrames);
      buffer.copyFromChannel(chunk, 0);

      chunksRef.current.push(chunk);
      totalFramesRef.current += numFrames;
      bufferedFramesRef.current += numFrames;

      // 2. Rolling window: only evict during IDLE with no voice candidate
      if (phaseRef.current === 'idle' && voiceStartTimeRef.current === null) {
        const maxFrames = MAX_IDLE_BUFFER_SECS * ctx.sampleRate;
        while (
          chunksRef.current.length > 1 &&
          bufferedFramesRef.current - chunksRef.current[0].length >= maxFrames
        ) {
          bufferedFramesRef.current -= chunksRef.current[0].length;
          chunksRef.current.shift();
        }
      }

      // 3. Compute RMS dB
      let sumSq = 0;
      for (let i = 0; i < numFrames; i++) sumSq += chunk[i] * chunk[i];
      const rms = Math.sqrt(sumSq / numFrames);
      const db = 20 * Math.log10(Math.max(rms, 1e-10));

      // 4. Update level history for visualization
      const normalized = Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
      setLevelHistory(prev => [...prev.slice(1), normalized]);

      // 5. Run state machine
      tickStateMachine(db, totalFramesRef.current, ctx.sampleRate);
    }
  );

  setPhase('idle');
}
```

> **Why `copyFromChannel`?** `AudioBuffer.getChannelData()` returns a view into the buffer's internal memory, which may be reused after the callback returns. `copyFromChannel(destination, 0)` safely copies data out: it transfers exactly `destination.length` frames, so allocating the destination as `new Float32Array(numFrames)` automatically handles partial trailing chunks without any manual slicing.

---

## 7. Metering & State Machine

Because `onAudioReady` drives everything, there is no `setInterval` and no React `useEffect` for metering. The state machine runs synchronously inside the callback.

### Refs (replace the old `recorderState`-watching `useEffect`)

```typescript
const phaseRef = useRef<Phase>('idle');          // authoritative phase for callback
const voiceStartTimeRef = useRef<number | null>(null);
const silenceStartTimeRef = useRef<number | null>(null);
```

`phaseRef` is the source of truth inside the callback. `setPhase` keeps React state in sync for UI rendering.

### `tickStateMachine`

```typescript
function tickStateMachine(db: number, totalFrames: number, sampleRate: number) {
  const now = Date.now();
  const durationMs = (totalFrames / sampleRate) * 1000;

  if (phaseRef.current === 'idle') {
    if (db > VOICE_THRESHOLD_DB) {
      if (voiceStartTimeRef.current === null) {
        voiceStartTimeRef.current = now;
        voiceStartFrameRef.current = totalFrames;   // save onset position
      } else if (now - voiceStartTimeRef.current >= VOICE_ONSET_MS) {
        silenceStartTimeRef.current = null;
        phaseRef.current = 'recording';
        setPhase('recording');
      }
    } else {
      voiceStartTimeRef.current = null;
    }

  } else if (phaseRef.current === 'recording') {
    const speechMs = durationMs - (voiceStartFrameRef.current / sampleRate) * 1000;

    if (db < SILENCE_THRESHOLD_DB && speechMs >= MIN_RECORDING_MS) {
      if (silenceStartTimeRef.current === null) {
        silenceStartTimeRef.current = now;
      } else if (now - silenceStartTimeRef.current >= SILENCE_DURATION_MS) {
        silenceStartTimeRef.current = null;
        phaseRef.current = 'playing';
        setPhase('playing');
        void stopAndPlay();   // async — safe to fire-and-forget from callback
      }
    } else if (db >= SILENCE_THRESHOLD_DB) {
      silenceStartTimeRef.current = null;
    }
  }
}
```

---

## 8. Playback: `AudioBufferSourceNode`

### Merging accumulated chunks

Because `chunksRef` is a rolling window, its length is `bufferedFramesRef.current` frames, not `totalFramesRef.current`. The voice onset is an **absolute** frame index; subtracting the buffer's start frame gives the offset within the merged `AudioBuffer`:

```typescript
function buildAudioBuffer(ctx: AudioContext): AudioBuffer {
  const bufferedFrames = bufferedFramesRef.current;
  const audioBuffer = ctx.createBuffer(1, bufferedFrames, ctx.sampleRate);

  let offset = 0;
  for (const chunk of chunksRef.current) {
    audioBuffer.copyToChannel(chunk, 0, offset);
    offset += chunk.length;
  }

  return audioBuffer;
}

// Voice onset offset within the merged buffer:
//   bufferStartFrame = totalFramesRef - bufferedFramesRef
//   voiceStartSecs   = (voiceStartFrameRef - bufferStartFrame) / sampleRate
```

### `stopAndPlay`

```typescript
async function stopAndPlay() {
  const ctx = audioContextRef.current!;
  const recorder = audioRecorderRef.current!;

  // Stop capturing
  recorder.clearOnAudioReady();
  await recorder.stop();

  if (chunksRef.current.length === 0) {
    await startMonitoring();
    return;
  }

  const audioBuffer = buildAudioBuffer(ctx);
  const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
  const voiceStartSecs = (voiceStartFrameRef.current - bufferStartFrame) / ctx.sampleRate;

  // Playback node — created fresh every time (AudioBufferSourceNode is single-use)
  const playerNode = ctx.createBufferSource();
  playerNode.buffer = audioBuffer;
  playerNode.connect(ctx.destination);

  // onLoopEnded fires when the buffer finishes playing
  playerNode.onLoopEnded = () => {
    void startMonitoring();
  };

  playerNode.start(ctx.currentTime, voiceStartSecs);
}
```

> **`AudioBufferSourceNode` is single-use.** Calling `.start()` a second time on the same node throws. Always create a fresh node per playback. The `AudioBuffer` itself is safely reusable, but since chunks are reset each cycle it can be garbage-collected after playback.

---

## 9. Permissions

Replace `requestRecordingPermissionsAsync` from `expo-audio` with `AudioManager` from `react-native-audio-api`:

```typescript
import { AudioManager } from 'react-native-audio-api';

useEffect(() => {
  (async () => {
    const status = await AudioManager.requestRecordingPermissions();
    if (status !== 'Granted') {
      setPermissionDenied(true);
      return;
    }
    setHasPermission(true);

    audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
    audioRecorderRef.current = new AudioRecorder();

    await startMonitoring();
  })();
}, []);
```

---

## 10. Cleanup on Unmount

```typescript
useEffect(() => {
  return () => {
    audioRecorderRef.current?.clearOnAudioReady();
    void audioRecorderRef.current?.stop();
    void audioContextRef.current?.close();
  };
}, []);
```

---

## 11. Full `useVoiceMirror` Hook

```typescript
// src/hooks/useVoiceMirror.ts

import { useEffect, useRef, useState } from 'react';
import { AudioContext, AudioRecorder, AudioManager } from 'react-native-audio-api';
import {
  VOICE_THRESHOLD_DB,
  SILENCE_THRESHOLD_DB,
  VOICE_ONSET_MS,
  SILENCE_DURATION_MS,
  MIN_RECORDING_MS,
  LEVEL_HISTORY_SIZE,
  DB_FLOOR,
  DB_CEIL,
} from '../constants/audio';
import type { Phase, VoiceMirrorState } from './types';

const SAMPLE_RATE = 44100;
const BUFFER_LENGTH = 4096;
const CHANNEL_COUNT = 1;
const MAX_IDLE_BUFFER_SECS = 30;

export function useVoiceMirror(): VoiceMirrorState {
  const [phase, setPhase] = useState<Phase>('idle');
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [levelHistory, setLevelHistory] = useState<number[]>(
    () => new Array(LEVEL_HISTORY_SIZE).fill(0),
  );

  // Audio engine (created once after permission granted)
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);

  // State machine refs (readable inside onAudioReady callback without stale closure issues)
  const phaseRef = useRef<Phase>('idle');
  const voiceStartTimeRef = useRef<number | null>(null);
  const silenceStartTimeRef = useRef<number | null>(null);

  // On-memory audio accumulation
  const chunksRef = useRef<Float32Array[]>([]);
  const totalFramesRef = useRef<number>(0);    // absolute; never decremented
  const bufferedFramesRef = useRef<number>(0); // frames currently in chunksRef
  const voiceStartFrameRef = useRef<number>(0); // absolute frame at voice onset

  // --- Permission + engine init ---
  useEffect(() => {
    (async () => {
      const status = await AudioManager.requestRecordingPermissions();
      if (status !== 'Granted') {
        setPermissionDenied(true);
        return;
      }
      setHasPermission(true);
      audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioRecorderRef.current = new AudioRecorder();
      await startMonitoring();
    })();

    return () => {
      audioRecorderRef.current?.clearOnAudioReady();
      void audioRecorderRef.current?.stop();
      void audioContextRef.current?.close();
    };
  }, []);

  // --- State machine (runs inside onAudioReady, not a useEffect) ---
  function tickStateMachine(db: number, totalFrames: number, sampleRate: number) {
    const now = Date.now();

    if (phaseRef.current === 'idle') {
      if (db > VOICE_THRESHOLD_DB) {
        if (voiceStartTimeRef.current === null) {
          voiceStartTimeRef.current = now;
          voiceStartFrameRef.current = totalFrames;
        } else if (now - voiceStartTimeRef.current >= VOICE_ONSET_MS) {
          silenceStartTimeRef.current = null;
          phaseRef.current = 'recording';
          setPhase('recording');
        }
      } else {
        voiceStartTimeRef.current = null;
      }
    } else if (phaseRef.current === 'recording') {
      const speechMs = ((totalFrames - voiceStartFrameRef.current) / sampleRate) * 1000;

      if (db < SILENCE_THRESHOLD_DB && speechMs >= MIN_RECORDING_MS) {
        if (silenceStartTimeRef.current === null) {
          silenceStartTimeRef.current = now;
        } else if (now - silenceStartTimeRef.current >= SILENCE_DURATION_MS) {
          silenceStartTimeRef.current = null;
          phaseRef.current = 'playing';
          setPhase('playing');
          void stopAndPlay();
        }
      } else if (db >= SILENCE_THRESHOLD_DB) {
        silenceStartTimeRef.current = null;
      }
    }
  }

  // --- Monitoring cycle ---
  async function startMonitoring() {
    const ctx = audioContextRef.current!;
    const recorder = audioRecorderRef.current!;

    chunksRef.current = [];
    totalFramesRef.current = 0;
    bufferedFramesRef.current = 0;
    voiceStartTimeRef.current = null;
    silenceStartTimeRef.current = null;
    voiceStartFrameRef.current = 0;
    phaseRef.current = 'idle';

    await AudioManager.setAudioSessionActivity(true);
    await recorder.start();

    recorder.onAudioReady(
      { sampleRate: ctx.sampleRate, bufferLength: BUFFER_LENGTH, channelCount: CHANNEL_COUNT },
      ({ buffer, numFrames }) => {
        // Copy samples — copyFromChannel transfers exactly numFrames frames
        const chunk = new Float32Array(numFrames);
        buffer.copyFromChannel(chunk, 0);

        chunksRef.current.push(chunk);
        totalFramesRef.current += numFrames;
        bufferedFramesRef.current += numFrames;

        // Rolling window: evict oldest chunks only while idle with no voice candidate
        if (phaseRef.current === 'idle' && voiceStartTimeRef.current === null) {
          const maxFrames = MAX_IDLE_BUFFER_SECS * ctx.sampleRate;
          while (
            chunksRef.current.length > 1 &&
            bufferedFramesRef.current - chunksRef.current[0].length >= maxFrames
          ) {
            bufferedFramesRef.current -= chunksRef.current[0].length;
            chunksRef.current.shift();
          }
        }

        // Compute RMS → dB
        let sumSq = 0;
        for (let i = 0; i < numFrames; i++) sumSq += chunk[i] * chunk[i];
        const rms = Math.sqrt(sumSq / numFrames);
        const db = 20 * Math.log10(Math.max(rms, 1e-10));

        // Update visualization
        const normalized = Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
        setLevelHistory(prev => [...prev.slice(1), normalized]);

        // State machine
        tickStateMachine(db, totalFramesRef.current, ctx.sampleRate);
      },
    );

    setPhase('idle');
  }

  // --- Stop recording + build buffer + play ---
  async function stopAndPlay() {
    const ctx = audioContextRef.current!;
    const recorder = audioRecorderRef.current!;

    recorder.clearOnAudioReady();
    await recorder.stop();

    if (chunksRef.current.length === 0) {
      await startMonitoring();
      return;
    }

    // Merge chunks into a single AudioBuffer (covers bufferedFramesRef frames)
    const bufferedFrames = bufferedFramesRef.current;
    const audioBuffer = ctx.createBuffer(1, bufferedFrames, ctx.sampleRate);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      audioBuffer.copyToChannel(chunk, 0, offset);
      offset += chunk.length;
    }

    // Compute voice onset offset within the merged buffer
    const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
    const voiceStartSecs = (voiceStartFrameRef.current - bufferStartFrame) / ctx.sampleRate;

    // Play from voice onset; onLoopEnded fires when playback finishes
    const playerNode = ctx.createBufferSource();
    playerNode.buffer = audioBuffer;
    playerNode.connect(ctx.destination);
    playerNode.onLoopEnded = () => {
      void startMonitoring();
    };
    playerNode.start(ctx.currentTime, voiceStartSecs);
  }

  return { phase, levelHistory, hasPermission, permissionDenied };
}
```

---

## 12. What Does Not Change

All of the following files are **unchanged**:

| File | Reason |
|---|---|
| `src/hooks/types.ts` | `Phase` and `VoiceMirrorState` types are identical |
| `src/constants/audio.ts` | All threshold constants remain the same |
| `src/components/AudioLevelMeter.tsx` | Receives normalized `[0,1]` history — format unchanged |
| `src/components/PhaseDisplay.tsx` | Receives `Phase` string — unchanged |
| `src/screens/VoiceMirrorScreen.tsx` | Renders `useVoiceMirror()` return value — unchanged |
| `App.tsx` | No changes needed |

---

## 13. Chunk Callback Timing & Chunk Size

`onAudioReady` fires once per `bufferLength` samples. With the defaults:

```
bufferLength = 4096 samples
sampleRate   = 44100 Hz
interval     = 4096 / 44100 ≈ 92.9 ms per chunk
```

This is very close to the current 100 ms expo-audio polling interval, so the perceived responsiveness of voice/silence detection is unchanged.

The `numFrames` argument in each callback may be less than `bufferLength` for the final chunk before `recorder.stop()` is called. The copy loop uses `numFrames`, not `bufferLength`, so partial trailing chunks are handled correctly.

---

## 14. Memory Usage

Memory is bounded in two ways:

**During IDLE (rolling window):**

```
MAX_IDLE_BUFFER_SECS × sampleRate × 4 bytes
= 30 s × 44100 × 4 = ~5.3 MB ceiling
```

**During RECORDING (speech take):**

A 60-second take (longer than any practical actor line) at 44100 Hz mono:

```
60 s × 44100 × 4 bytes = ~10.6 MB
```

Plus the merged `AudioBuffer` that exists briefly at playback start (same size). Peak memory per cycle is therefore bounded at ~21 MB for an absurdly long take; real takes are typically 5–30 seconds.

Both are cleared in `startMonitoring()` at the start of each new cycle.

---

## 15. Known Unknowns / Things to Verify

| # | Question | Impact if wrong | Fallback |
|---|---|---|---|
| 1 | Does `AudioManager.setAudioSessionActivity(true/false)` alone route playback to the speaker on iOS, or is additional configuration needed? | Audio may play through earpiece during playback | Check for a `setCategory`-style API or `AudioManager` speaker routing option |
| 2 | Does `recorder.start()` need to be called after every `recorder.stop()`, or can we call `recorder.record()` (like expo-audio) to restart the same session? | If the latter, `start()` re-initialization overhead is avoidable | `start()` appears to be the correct restart method based on docs |
| 3 | What does `onAudioReady` deliver if `channelCount: 1` is specified but the device records in stereo? | Extra channels would be silently dropped or cause an error | Test with mono; fall back to `channelCount: 2` with only channel 0 used |

**Resolved:** Callback buffer lifetime — use `buffer.copyFromChannel(chunk, 0)` to copy data out safely. It transfers exactly `destination.length` frames, making the internal memory lifetime irrelevant.

**Resolved:** `AudioBufferSourceNode.onLoopEnded` fires when buffer playback completes. Used instead of `setTimeout` for end-of-playback detection. Ref: https://docs.swmansion.com/react-native-audio-api/docs/sources/audio-buffer-source-node

---

## 16. Implementation Steps

1. **Remove `expo-audio`**
   ```bash
   pnpm remove expo-audio
   ```

2. **Install `react-native-audio-api`**
   ```bash
   npx expo install react-native-audio-api
   ```

3. **Update `app.json`** — add the plugin block (section 5), remove the bare `NSMicrophoneUsageDescription` and `android.permissions` fields.

4. **Rewrite `src/hooks/useVoiceMirror.ts`** with the implementation in section 11.

5. **Trigger a new EAS development build** (native module changed)
   ```bash
   pnpm run build:dev:ios
   ```

6. **Install the build on device and test the full loop.**

---

## 17. Todo List

### Phase 1 — Dependencies & configuration

- [x] Remove `expo-audio`: `pnpm remove expo-audio`
- [x] Install `react-native-audio-api`: `npx expo install react-native-audio-api`
- [x] Add the `react-native-audio-api` Expo plugin block to `app.json` with `iosMicrophonePermission` and `androidPermissions`
- [x] Remove the now-redundant `ios.infoPlist.NSMicrophoneUsageDescription` field from `app.json`
- [x] Remove the now-redundant `android.permissions` array from `app.json`

### Phase 2 — Rewrite `useVoiceMirror.ts`

#### 2a. Module-level constants

- [x] Replace `expo-audio` imports with `AudioContext`, `AudioRecorder`, `AudioManager` from `react-native-audio-api`
- [x] Add module-level constants: `SAMPLE_RATE`, `BUFFER_LENGTH`, `CHANNEL_COUNT`, `MAX_IDLE_BUFFER_SECS`

#### 2b. Refs

- [x] Remove all `useAudioRecorder`, `useAudioPlayer`, `useAudioRecorderState`, `useAudioPlayerStatus` hook calls
- [x] Add `audioContextRef` and `audioRecorderRef` (created after permission granted, not at hook init time)
- [x] Add `phaseRef` — authoritative phase for the `onAudioReady` callback, kept in sync with `setPhase`
- [x] Replace `voiceStartMsRef` with `voiceStartFrameRef` (absolute frame index, not milliseconds)
- [x] Replace single `chunksRef` accumulator with the rolling-window trio: `chunksRef`, `totalFramesRef`, `bufferedFramesRef`
- [x] Keep `voiceStartTimeRef` and `silenceStartTimeRef` unchanged

#### 2c. Permission effect

- [x] Replace `requestRecordingPermissionsAsync()` with `AudioManager.requestRecordingPermissions()`; check result against `'Granted'` string (not a `{ granted }` object)
- [x] Construct `AudioContext` and `AudioRecorder` inside the effect, after permission is confirmed
- [x] Move cleanup (`clearOnAudioReady`, `recorder.stop()`, `ctx.close()`) into the effect's return function, removing the separate cleanup `useEffect`

#### 2d. `startMonitoring`

- [x] Remove `setAudioModeAsync` recording-mode call; replace with `AudioManager.setAudioSessionActivity(true)`
- [x] Remove `recorder.prepareToRecordAsync()` and `recorder.record()` calls; replace with `await recorder.start()`
- [x] Reset `bufferedFramesRef` alongside the other refs
- [x] Register `onAudioReady` with `{ sampleRate: ctx.sampleRate, bufferLength: BUFFER_LENGTH, channelCount: CHANNEL_COUNT }`
- [x] Inside the callback: copy chunk with `buffer.copyFromChannel(chunk, 0)` where `chunk = new Float32Array(numFrames)`
- [x] Inside the callback: update both `totalFramesRef` and `bufferedFramesRef`
- [x] Inside the callback: apply rolling-window eviction — only when `phaseRef === 'idle' && voiceStartTimeRef === null`; evict from front of `chunksRef` and decrement `bufferedFramesRef` accordingly
- [x] Inside the callback: compute RMS dB from the copied chunk
- [x] Inside the callback: normalize dB and call `setLevelHistory`
- [x] Inside the callback: call `tickStateMachine(db, totalFramesRef.current, ctx.sampleRate)`

#### 2e. `tickStateMachine`

- [x] Replace the metering `useEffect` (which watched `recorderState`) with a plain function `tickStateMachine` called from inside `onAudioReady`
- [x] Read phase from `phaseRef.current` (not the `phase` state variable) to avoid stale closures
- [x] In IDLE branch: on first voice detection, record `voiceStartFrameRef.current = totalFrames` (absolute frame, not ms)
- [x] In RECORDING branch: compute `speechMs` as `((totalFrames - voiceStartFrameRef.current) / sampleRate) * 1000` — no longer subtract a `durationMs` derived from a recorder timestamp
- [x] Set `phaseRef.current` before calling `setPhase` on every transition

#### 2f. `stopAndPlay`

- [x] Remove `setAudioModeAsync` playback-mode call (no equivalent needed — verify during testing)
- [x] Replace `recorder.stop()` / `recorder.uri` pattern: call `recorder.clearOnAudioReady()` first, then `await recorder.stop()`; no URI involved
- [x] Remove `player.replace()` and `player.seekTo()` calls entirely
- [x] Build merged `AudioBuffer` using `ctx.createBuffer(1, bufferedFramesRef.current, ctx.sampleRate)`
- [x] Populate it by iterating `chunksRef.current` and calling `audioBuffer.copyToChannel(chunk, 0, offset)` for each chunk
- [x] Compute `bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current`
- [x] Compute `voiceStartSecs = (voiceStartFrameRef.current - bufferStartFrame) / ctx.sampleRate`
- [x] Create a fresh `AudioBufferSourceNode` via `ctx.createBufferSource()`; assign `.buffer`; connect to `ctx.destination`
- [x] Set `playerNode.onLoopEnded = () => void startMonitoring()` — replaces `useAudioPlayerStatus().didJustFinish` and `setTimeout`
- [x] Call `playerNode.start(ctx.currentTime, voiceStartSecs)`

#### 2g. Remove dead code

- [x] Delete `setRecordingMode` helper (was `setAudioModeAsync` wrapper)
- [x] Delete `setPlaybackMode` helper (was `setAudioModeAsync` wrapper)
- [x] Delete the `useEffect` that watched `playerStatus.didJustFinish`
- [x] Delete the separate cleanup `useEffect` (merged into the permission effect's return)

### Phase 3 — Build

- [ ] Trigger EAS development build: `pnpm run build:dev:ios`
- [ ] Install the resulting `.ipa` on the test device

### Phase 4 — Verification (known unknowns)

- [ ] Confirm playback routes through the loudspeaker, not earpiece — verify whether `AudioManager.setAudioSessionActivity` alone is sufficient on iOS, or whether additional session category configuration is needed
- [ ] Confirm `recorder.start()` / `recorder.stop()` is the correct restart pattern (vs. a `recorder.record()` method like expo-audio)
- [ ] Confirm `onAudioReady` with `channelCount: 1` works on device without error; fall back to `channelCount: 2` using only channel 0 if needed

### Phase 5 — Testing

- [ ] Microphone permission prompt appears on first launch
- [ ] Waveform bars animate in response to ambient sound while idle
- [ ] `idle` → `recording` transition triggers reliably; tune `VOICE_THRESHOLD_DB` / `VOICE_ONSET_MS` if needed
- [ ] `recording` → `playing` triggers after sustained silence; tune `SILENCE_THRESHOLD_DB` / `SILENCE_DURATION_MS` if needed
- [ ] Playback starts from voice onset with no audible leading silence
- [ ] `onLoopEnded` fires and monitoring restarts automatically after playback
- [ ] Very short sounds (< 500 ms of speech) do not trigger playback
- [ ] No audio from prior takes bleeds into the next cycle (chunks cleared in `startMonitoring`)
- [ ] App remains stable across rapid speech → silence → speech transitions
- [ ] App held idle for several minutes does not grow memory unboundedly (rolling window working)
