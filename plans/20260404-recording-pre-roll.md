# Recording Pre-Roll to Prevent Clipped Start Sound

## Goal

Prevent the subtle clipping/cutting of the very beginning of speech during playback. Currently, when voice onset is detected, the recording starts from the exact frame where the audio first exceeded the voice threshold. Because natural speech has a gradual attack (consonant bursts, breaths, plosives), this precise boundary cuts off the perceptual beginning of the utterance, giving the impression of a chopped voice. By including a short pre-roll of approximately 100ms of audio before the detected voice onset, the playback will sound more natural and complete.

## Architecture / Approach

### Current behavior

The voice detection pipeline in `useVoiceMirror` works as follows:

1. During idle phase, audio chunks from the microphone are continuously pushed to `chunksRef` (a circular buffer).
2. When a chunk's RMS level exceeds `voiceThresholdDb`, `voiceStartTimeRef` is set to the current wall-clock time and `voiceStartFrameRef` is set to the current `totalFramesRef` value (the exact frame where voice was first detected).
3. If voice persists for `voiceOnsetMs` (250ms by default), the phase transitions to `recording` and `beginEncoding()` is called.
4. `beginEncoding()` retroactively encodes all buffered chunks starting from `voiceStartFrameRef` onward.
5. `stopAndPlay()` plays back the in-memory audio buffer starting from `voiceStartSecs`, computed as `(voiceStartFrameRef - bufferStartFrame) / sampleRate`.

The problem is at step 2: `voiceStartFrameRef` points to the exact moment voice was first detected. The audio right before that point -- containing the perceptual onset of the sound -- is discarded from both the encoded file and the playback.

### Proposed change

Introduce a constant `PRE_ROLL_MS = 100` and, at the moment `voiceStartFrameRef` is set, subtract the equivalent number of frames from the position. This moves the "start of recording" marker backward by 100ms, capturing the subtle lead-in before voice crosses the threshold.

The change is confined to a single code site: the assignment of `voiceStartFrameRef` in `tickStateMachine()`. The pre-roll frames must be clamped so the marker never goes before the start of the buffered audio (i.e., `voiceStartFrameRef` must not be less than `totalFramesRef - bufferedFramesRef`).

Both `beginEncoding()` and `stopAndPlay()` already use `voiceStartFrameRef` as their starting point -- no changes are needed in either function. They will automatically pick up the earlier start position.

### Why this is safe

- The circular buffer in idle phase retains up to `MAX_IDLE_BUFFER_SECS` (30 seconds) of audio. Even with just 100ms of monitoring, the buffer will contain enough data (or the clamp will handle the edge case of a very short buffer).
- The encoder already iterates through chunks starting from `voiceStartFrameRef`, skipping earlier audio. Moving the marker backward simply includes more chunks in the encoding.
- The playback offset calculation `(voiceStartFrameRef - bufferStartFrame) / sampleRate` produces a smaller offset, starting playback earlier. No math changes needed.

## Code Changes

### 1. Add `PRE_ROLL_MS` constant

**File: `/Users/tai2/VoiceMirror/src/hooks/useVoiceMirror.ts`**

Add a new constant alongside the existing ones at the top of the file:

```typescript
const BUFFER_LENGTH = 4096;
const CHANNEL_COUNT = 1;
const MAX_IDLE_BUFFER_SECS = 30;
const PRE_ROLL_MS = 100;
```

This is placed in the hook file rather than in `src/constants/audio.ts` because it is an internal implementation detail of the voice detection state machine, not a shared constant used across multiple modules.

### 2. Apply pre-roll offset when setting `voiceStartFrameRef`

**File: `/Users/tai2/VoiceMirror/src/hooks/useVoiceMirror.ts`**

In `tickStateMachine()`, when voice first exceeds the threshold and `voiceStartTimeRef` is null, compute the pre-roll-adjusted start frame with a floor clamp:

Current code (lines 118-131):

```typescript
if (phaseRef.current === 'idle') {
  if (db > s.voiceThresholdDb) {
    if (voiceStartTimeRef.current === null) {
      voiceStartTimeRef.current = now;
      voiceStartFrameRef.current = totalFrames;
    } else if (now - voiceStartTimeRef.current >= s.voiceOnsetMs) {
      silenceStartTimeRef.current = null;
      phaseRef.current = 'recording';
      setPhase('recording');
      beginEncoding();
    }
  } else {
    voiceStartTimeRef.current = null;
  }
}
```

Changed code:

```typescript
if (phaseRef.current === 'idle') {
  if (db > s.voiceThresholdDb) {
    if (voiceStartTimeRef.current === null) {
      voiceStartTimeRef.current = now;
      const preRollFrames = Math.round((PRE_ROLL_MS / 1000) * sampleRate);
      const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
      voiceStartFrameRef.current = Math.max(
        bufferStartFrame,
        totalFrames - preRollFrames,
      );
    } else if (now - voiceStartTimeRef.current >= s.voiceOnsetMs) {
      silenceStartTimeRef.current = null;
      phaseRef.current = 'recording';
      setPhase('recording');
      beginEncoding();
    }
  } else {
    voiceStartTimeRef.current = null;
  }
}
```

The key changes:
- `preRollFrames` is computed from `PRE_ROLL_MS` and the current `sampleRate` (e.g., at 48000 Hz, this is 4800 frames).
- `bufferStartFrame` represents the absolute frame position of the earliest data still in the buffer. This is `totalFramesRef.current - bufferedFramesRef.current`.
- `Math.max(bufferStartFrame, totalFrames - preRollFrames)` ensures the pre-roll never reaches before the start of available buffered audio. If monitoring just started and less than 100ms of audio exists, the pre-roll will use whatever is available.

### 3. No changes needed in `beginEncoding()`

`beginEncoding()` already starts from `voiceStartFrameRef`:

```typescript
const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
let framesCounted = 0;
for (const chunk of chunksRef.current) {
  const chunkStart = bufferStartFrame + framesCounted;
  const chunkEnd = chunkStart + chunk.length;
  framesCounted += chunk.length;

  if (chunkEnd <= voiceStartFrameRef.current) continue;

  const skipInChunk = Math.max(0, voiceStartFrameRef.current - chunkStart);
  const slice = skipInChunk > 0 ? chunk.slice(skipInChunk) : chunk;
  encoderService.encodeChunk(slice);
}
```

With the pre-roll adjustment, `voiceStartFrameRef` now points 100ms earlier, so this loop will naturally include the pre-roll audio in the encoded file. No modifications required.

### 4. No changes needed in `stopAndPlay()`

The playback offset calculation:

```typescript
const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
const voiceStartSecs = (voiceStartFrameRef.current - bufferStartFrame) / context.sampleRate;
```

Since `voiceStartFrameRef` is now 100ms earlier, `voiceStartSecs` will be correspondingly earlier, and playback will start from the pre-roll position. No modifications required.

### 5. Update tests

**File: `/Users/tai2/VoiceMirror/src/hooks/__tests__/useVoiceMirror.test.ts`**

Add a test verifying that encoding begins with pre-roll audio before the voice detection point.

```typescript
it('includes pre-roll audio before voice detection point in encoding', async () => {
  const { recordingService, encoderService } = await setupWithPermission();

  // Feed several silent chunks first so the buffer has data before voice onset
  act(() => {
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeSilentChunk());
    }
  });

  // Now trigger voice onset
  act(() => { simulateVoiceOnset(recordingService); });

  // encodeChunk should have been called with audio that includes pre-roll
  // (chunks from before the voice detection threshold crossing)
  const totalEncodedFrames = encoderService.encodeChunk.mock.calls.reduce(
    (sum, [chunk]) => sum + chunk.length,
    0,
  );

  // The voice onset detection fires at voiceStartFrame.
  // With 250ms onset delay and 100ms chunks, we get onset after ~3 loud chunks.
  // The encoded audio should include ~100ms of pre-roll before that point.
  // At 44100 Hz, 100ms = 4410 frames.
  // Total encoded frames should be greater than just the onset-period frames.
  const voiceOnsetFrames = Math.round((VOICE_ONSET_MS / 1000) * 44100);
  expect(totalEncodedFrames).toBeGreaterThan(voiceOnsetFrames);
});
```

Add a test verifying the pre-roll is clamped when the buffer is shorter than 100ms:

```typescript
it('clamps pre-roll to buffer start when less than 100ms of audio exists', async () => {
  const { recordingService, encoderService } = await setupWithPermission();

  // Immediately start with loud chunks (no silent pre-buffer)
  // The very first chunk triggers voice onset detection
  act(() => { simulateVoiceOnset(recordingService); });

  // Encoding should succeed without errors even when pre-roll
  // would extend before the buffer start
  expect(encoderService.startEncoding).toHaveBeenCalledTimes(1);
  expect(encoderService.encodeChunk).toHaveBeenCalled();
});
```

## File Paths That Need Modification

| File | Change |
|------|--------|
| `/Users/tai2/VoiceMirror/src/hooks/useVoiceMirror.ts` | Add `PRE_ROLL_MS` constant; adjust `voiceStartFrameRef` assignment in `tickStateMachine()` |
| `/Users/tai2/VoiceMirror/src/hooks/__tests__/useVoiceMirror.test.ts` | Add tests for pre-roll behavior and buffer-start clamping |

## Considerations and Trade-offs

### Why 100ms?

100ms is a common pre-roll duration used in voice activity detection systems. It is long enough to capture the attack transients of plosive consonants (p, t, k, b, d, g) which have bursts lasting 10-40ms, plus a comfortable margin. It is short enough to avoid including perceptible silence or background noise that would make the playback feel delayed.

### Why not make it a user-configurable setting?

The pre-roll is an implementation detail to improve perceived audio quality, not a detection tuning parameter. Unlike `voiceOnsetMs` or `silenceThresholdDb`, users would not benefit from adjusting this value. Adding it as a setting would increase UI complexity without meaningful gain. If needed in the future, it can be promoted to a setting at that time.

### Impact on recording duration

The pre-roll adds approximately 100ms to every recording. For a 1-second recording, this is a 10% increase; for a 60-second recording, it is negligible (0.17%). The additional 100ms of audio in the encoded M4A file is on the order of a few hundred bytes at 128kbps AAC. Memory impact during recording is also negligible -- 100ms at 48000 Hz mono = 4800 Float32 samples = ~19 KB.

### Impact on the speech duration calculation (`speechMs`)

The `speechMs` calculation in `tickStateMachine()` (line 133) computes elapsed recording time from `voiceStartFrameRef`:

```typescript
const speechMs = ((totalFrames - voiceStartFrameRef.current) / sampleRate) * 1000;
```

With the pre-roll, `voiceStartFrameRef` is 100ms earlier, so `speechMs` will be ~100ms larger than actual speech duration. This means:
- `minRecordingMs` (500ms) will be reached ~100ms sooner. This is acceptable -- the guard is approximate anyway and 400ms of actual speech is still a reasonable minimum.
- `maxRecordingMs` (60000ms) will trigger ~100ms sooner. At 60 seconds, this is negligible.
- Silence detection (`speechMs >= minRecordingMs`) will be unblocked marginally earlier. No perceptible impact.

This minor shift is acceptable and does not warrant adding compensating logic.

### Edge case: voice onset resets

If voice drops below threshold during the onset period, `voiceStartTimeRef` is reset to null (line 130). On the next voice detection, `voiceStartFrameRef` is recalculated with a fresh pre-roll from the new position. The previous pre-roll-adjusted value is simply overwritten. This is correct behavior -- the pre-roll should always be relative to the most recent voice onset attempt.

### Interaction with idle buffer pruning

The idle buffer pruning (lines 184-193) only runs when `voiceStartTimeRef.current === null` (no voice onset in progress). Once voice is detected and `voiceStartTimeRef` is set, pruning stops. This means the pre-roll audio in the buffer will never be pruned between the time voice is first detected and when recording begins. The pre-roll data is safe.

## Todo

### 1. Add `PRE_ROLL_MS` constant

- [x] Add `const PRE_ROLL_MS = 100;` alongside existing constants (`BUFFER_LENGTH`, `CHANNEL_COUNT`, `MAX_IDLE_BUFFER_SECS`) at the top of `src/hooks/useVoiceMirror.ts`

### 2. Apply pre-roll offset in `tickStateMachine()`

- [x] In the `if (voiceStartTimeRef.current === null)` branch inside `tickStateMachine()`, compute `preRollFrames` from `PRE_ROLL_MS` and `sampleRate`
- [x] Compute `bufferStartFrame` as `totalFramesRef.current - bufferedFramesRef.current`
- [x] Replace the direct assignment `voiceStartFrameRef.current = totalFrames` with `voiceStartFrameRef.current = Math.max(bufferStartFrame, totalFrames - preRollFrames)`

### 3. Verify no changes needed in `beginEncoding()`

- [x] Confirm that `beginEncoding()` still correctly iterates from `voiceStartFrameRef` and that the pre-roll-adjusted value causes it to include the extra ~100ms of audio without errors

### 4. Verify no changes needed in `stopAndPlay()`

- [x] Confirm that the playback offset calculation `(voiceStartFrameRef.current - bufferStartFrame) / context.sampleRate` produces a correct earlier start position with the pre-roll adjustment

### 5. Add unit tests

- [x] Add a test that feeds several silent chunks before voice onset, triggers voice onset, and verifies that `encodeChunk` receives more frames than just the onset-period frames (confirming pre-roll audio is included)
- [x] Add a test that triggers voice onset immediately without any pre-buffered silent chunks, and verifies that encoding starts successfully without errors (confirming the buffer-start clamp works)

### 6. Run verification checks

- [x] Run `pnpm typecheck` and confirm no type errors
- [x] Run `pnpm lint` and confirm no lint errors
- [x] Run `pnpm test:ci` and confirm all tests pass (including the new pre-roll tests)
