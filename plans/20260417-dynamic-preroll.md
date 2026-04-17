# Dynamic Pre-Roll Based on Silence Threshold Crossing

## Goal

Eliminate the remaining start-of-speech clipping that persists even with the current fixed 100ms pre-roll. Currently, `voiceStartFrameRef` is set to 100ms before the frame that first crosses `voiceThresholdDb` (-35 dB). However, natural speech has a gradual attack that may begin well before that 100ms window -- the perceptual onset of the utterance can start from the moment audio first rises above the ambient noise floor. A fixed 100ms pre-roll is insufficient when the attack envelope is slow or when the speaker is far from the microphone.

The improvement: instead of a fixed 100ms look-back, scan backward through buffered audio to find where the signal first crosses `silenceThresholdDb` (-45 dB), then include an additional 100ms safety margin beyond that point. This captures the full speech attack envelope dynamically, regardless of its duration.

## Architecture / Approach

### Problem analysis

The current pre-roll captures a fixed window:

```
  ──────┬─────────────────────┬──────────────────
        │    100ms pre-roll    │
        │◄───────────────────►│
  silence                     voice threshold crossed
                              (voiceStartFrameRef set here minus 100ms)
```

But the actual speech attack may look like this:

```
  ──────────┬───────────────────────────────┬────
            │ speech energy rising gradually │
  silence   │ (below voiceThresholdDb but    │ voice threshold crossed
  threshold │  above silenceThresholdDb)     │
  crossing  │◄─ this can be 50-300ms+ ──────►│
```

When the rising portion exceeds 100ms, the fixed pre-roll fails to capture the beginning of the attack, and the playback sounds clipped.

### Proposed approach

Replace the fixed pre-roll calculation with a backward scan from the voice detection point through the buffered chunks. The scan searches for the last frame (going backward) where the audio level drops below `silenceThresholdDb`. That frame marks the true "start of sound activity." Then, an additional 100ms safety margin is added before that point to capture any sub-threshold lead-in.

```
  ──────┬──────────────────────────────────────┬────
        │  100ms     silence threshold crossing │
        │  margin    found by backward scan     │ voice threshold crossed
        │◄──────►◄──────────────────────────────►│
        │                                        │
  voiceStartFrameRef set here                   detection point
```

This approach:

- Adapts to any attack duration -- whether 30ms or 300ms
- Keeps the 100ms safety margin for sub-threshold transients
- Falls back gracefully: if the backward scan immediately finds silence (the attack was very sudden), the behavior is equivalent to the current fixed 100ms pre-roll
- Is clamped to the start of the circular buffer, same as before

### Why scan at the chunk level

Each buffered chunk is ~85ms at 48kHz (4096 frames / 48000 Hz) or ~93ms at 44.1kHz. Scanning chunk-by-chunk with `computeLevel()` provides sufficient temporal resolution for finding the onset boundary -- we don't need frame-level scanning because the 100ms safety margin absorbs any chunk-boundary imprecision. This keeps the implementation simple and efficient.

### Design: single function extraction

The backward scan logic will be extracted into a pure helper function `findPreRollStartFrame()` within `useVoiceMirror.ts`. This keeps the change localized (same file, same module) while making the logic independently testable if desired. The function takes the chunks array, frame tracking state, sample rate, and threshold as inputs, and returns the absolute frame position for `voiceStartFrameRef`.

## Code Changes

### 1. Add `findPreRollStartFrame()` helper function

**File: `/Users/tai2/VoiceMirror/src/hooks/useVoiceMirror.ts`**

Add a new function after the constant definitions and before `useVoiceMirror()`. This replaces the inline pre-roll calculation:

```typescript
const SAFETY_MARGIN_MS = 100;

/**
 * Scan backward through buffered chunks to find where audio first rises
 * above the silence threshold, then add a safety margin before that point.
 * This captures the full speech attack envelope dynamically.
 */
function findPreRollStartFrame(
  chunks: Float32Array[],
  totalFrames: number,
  bufferedFrames: number,
  sampleRate: number,
  silenceThresholdDb: number,
): number {
  const bufferStartFrame = totalFrames - bufferedFrames;
  const safetyMarginFrames = Math.round((SAFETY_MARGIN_MS / 1000) * sampleRate);

  // Walk chunks backward from the most recent to find where audio
  // drops below silenceThresholdDb
  let framesToEnd = 0; // frames from chunk start to buffer end (accumulated backward)
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const { db } = computeLevel(chunk, 0, chunk.length);
    framesToEnd += chunk.length;

    if (db < silenceThresholdDb) {
      // This chunk is below silence threshold -- the onset starts
      // at the next chunk (i+1). Compute the absolute frame position
      // of the boundary, then subtract the safety margin.
      const onsetFrame = totalFrames - framesToEnd + chunk.length;
      const preRollFrame = onsetFrame - safetyMarginFrames;
      return Math.max(bufferStartFrame, preRollFrame);
    }
  }

  // All buffered chunks are above silenceThresholdDb (rare, but possible
  // in noisy environments). Fall back to including all buffered audio
  // minus any excess beyond a reasonable limit.
  return bufferStartFrame;
}
```

### 2. Replace the `PRE_ROLL_MS` constant with `SAFETY_MARGIN_MS`

**File: `/Users/tai2/VoiceMirror/src/hooks/useVoiceMirror.ts`**

Remove the old constant:

```typescript
// Remove this line:
const PRE_ROLL_MS = 100;
```

The new `SAFETY_MARGIN_MS = 100` constant (added alongside `findPreRollStartFrame()`) serves a different semantic purpose: it is the safety margin after finding the silence-threshold crossing, not the total pre-roll duration.

### 3. Update `tickStateMachine()` to use `findPreRollStartFrame()`

**File: `/Users/tai2/VoiceMirror/src/hooks/useVoiceMirror.ts`**

Current code (lines 155-164):

```typescript
if (voiceStartTimeRef.current === null) {
  voiceStartTimeRef.current = now;
  const preRollFrames = Math.round((PRE_ROLL_MS / 1000) * sampleRate);
  const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
  voiceStartFrameRef.current = Math.max(
    bufferStartFrame,
    totalFrames - preRollFrames,
  );
}
```

Changed code:

```typescript
if (voiceStartTimeRef.current === null) {
  voiceStartTimeRef.current = now;
  voiceStartFrameRef.current = findPreRollStartFrame(
    chunksRef.current,
    totalFramesRef.current,
    bufferedFramesRef.current,
    sampleRate,
    s.silenceThresholdDb,
  );
}
```

This is cleaner and delegates all the complexity to the helper function. The `tickStateMachine()` function signature does not change -- `silenceThresholdDb` is already available via `settingsRef.current` (accessed as `s`).

### 4. Update unit tests

**File: `/Users/tai2/VoiceMirror/src/hooks/__tests__/useVoiceMirror.test.ts`**

The existing pre-roll tests should still pass conceptually, but may need adjustment for the new behavior. The first test ("includes pre-roll audio before voice detection point in encoding") feeds 5 silent chunks then loud chunks. With the new logic, the backward scan from the voice detection point will hit the silent chunks and mark the onset at the boundary between silent and loud chunks, then add 100ms safety margin. The total encoded frames should still exceed `voiceOnsetFrames`.

Additionally, add a new test that verifies the dynamic scan captures a gradual attack:

```typescript
it("captures gradual speech attack by scanning backward to silence threshold", async () => {
  const { recordingService, encoderService } = await setupWithPermission();

  // Feed silent chunks (background noise)
  act(() => {
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeSilentChunk());
    }
  });

  // Feed "rising" chunks: above silence threshold but below voice threshold
  // This simulates a gradual speech attack
  const risingChunk = makeRisingChunk();
  act(() => {
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(risingChunk);
    }
  });

  // Now trigger voice onset with loud chunks
  act(() => {
    simulateVoiceOnset(recordingService);
  });

  const totalEncodedFrames = encoderService.encodeChunk.mock.calls.reduce(
    (sum: number, [chunk]: [Float32Array]) => sum + chunk.length,
    0,
  );

  // The encoded audio should include:
  // - The 3 rising chunks (~300ms of gradual attack)
  // - 100ms safety margin (reaching into the silent zone)
  // - The voice onset chunks (~250ms)
  // This should be significantly more than just onset + fixed 100ms
  const voiceOnsetFrames = Math.round((VOICE_ONSET_MS / 1000) * 44100);
  const risingFrames = 3 * Math.round((100 / 1000) * 44100);
  expect(totalEncodedFrames).toBeGreaterThan(voiceOnsetFrames + risingFrames);
});
```

A helper `makeRisingChunk()` is needed -- it produces audio above `SILENCE_THRESHOLD_DB` but below `VOICE_THRESHOLD_DB`:

```typescript
function makeRisingChunk(durationMs = 100, sampleRate = 44100): Float32Array {
  const numFrames = Math.round((durationMs / 1000) * sampleRate);
  // Level between silence and voice thresholds: midpoint in dB
  const midDb = (SILENCE_THRESHOLD_DB + VOICE_THRESHOLD_DB) / 2; // -40 dB
  const rms = Math.pow(10, midDb / 20);
  return new Float32Array(numFrames).fill(rms);
}
```

Also update the clamp test to work with the new logic:

```typescript
it("clamps pre-roll to buffer start when buffer is very short", async () => {
  const { recordingService, encoderService } = await setupWithPermission();

  // Immediately start with loud chunks (no silent pre-buffer)
  // The backward scan will find no chunk below silenceThresholdDb
  // and fall back to bufferStartFrame
  act(() => {
    simulateVoiceOnset(recordingService);
  });

  expect(encoderService.startEncoding).toHaveBeenCalledTimes(1);
  expect(encoderService.encodeChunk).toHaveBeenCalled();
});
```

## File Paths That Need Modification

| File                                                                 | Change                                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/Users/tai2/VoiceMirror/src/hooks/useVoiceMirror.ts`                | Remove `PRE_ROLL_MS`; add `SAFETY_MARGIN_MS` and `findPreRollStartFrame()` helper; update `tickStateMachine()` to call the helper |
| `/Users/tai2/VoiceMirror/src/hooks/__tests__/useVoiceMirror.test.ts` | Add `makeRisingChunk()` helper; add test for gradual attack capture; verify existing pre-roll tests still pass                    |

## Considerations and Trade-offs

### Computational cost of backward scan

The backward scan iterates through chunks calling `computeLevel()` on each. In the worst case (all buffered audio is above silence threshold), this scans the entire 30-second buffer (~350 chunks at 48kHz). However, this scan only runs once per voice onset detection -- not per audio frame. At the typical case where silence is found within a few chunks, the cost is negligible. Even the worst case (350 iterations of a simple RMS calculation) completes in microseconds.

### Chunk-level vs frame-level granularity

The scan operates at chunk granularity (~85-93ms per chunk). This means the onset boundary is located with ~85-93ms precision. However, the 100ms safety margin compensates for this imprecision: even if the scan identifies the wrong chunk as the onset boundary (off by one chunk), the safety margin ensures the true onset is still captured. Frame-level scanning within chunks would add complexity without meaningful benefit.

### Re-using `silenceThresholdDb` for the backward scan

The scan uses the same `silenceThresholdDb` (-45 dB) that drives silence detection during recording. This is intentionally the same threshold: it represents the level below which audio is considered "not speech." Using a separate threshold would add a configuration parameter that is difficult for users to reason about. The existing threshold is already well-tuned for the app's purpose.

### Fallback when all buffered audio is above silence threshold

In noisy environments, ambient noise may consistently exceed `silenceThresholdDb`. In this case, the backward scan reaches the beginning of the buffer without finding a silent chunk. The function falls back to `bufferStartFrame`, meaning the entire buffer is included in the pre-roll. This is conservative but correct -- it is better to include too much pre-roll (extra ambient noise) than to clip the speech onset. In practice, the buffer is pruned to 30 seconds maximum, so the worst case is a 30-second pre-roll, which is unusual but harmless (the extra audio is ambient noise that the user would hear anyway in the played-back recording).

### Impact on `speechMs` calculation

With the fixed 100ms pre-roll, `speechMs` was inflated by ~100ms. With the dynamic pre-roll, the inflation depends on the attack duration and can be larger (e.g., 400ms if the attack is gradual). This means `minRecordingMs` (500ms) could be reached significantly sooner than before. For example, with a 300ms pre-roll, the guard would trigger at only ~200ms of actual speech. This is a more significant shift than the fixed 100ms case.

However, this is acceptable because:

1. The `minRecordingMs` guard exists to prevent extremely short accidental recordings (coughs, taps). A 200ms utterance with a 300ms attack envelope is not an accidental noise -- it is genuine speech that the user would want captured.
2. The alternative (compensating `speechMs` by subtracting the pre-roll duration) would require tracking the pre-roll size separately and threading it through the state machine, adding complexity for minimal gain.

### Why keep the 100ms safety margin

Even after finding the silence-threshold crossing point, the 100ms margin serves two purposes:

1. It captures sub-threshold transients (breaths, lip movements) that precede the measurable onset
2. It absorbs chunk-boundary imprecision so the scan doesn't need frame-level resolution

### No changes needed in `beginEncoding()` or `stopAndPlay()`

Both functions consume `voiceStartFrameRef` unchanged. The dynamic pre-roll only changes how `voiceStartFrameRef` is computed -- the downstream consumers are unaffected. This preserves the original plan's design principle of a single point of change.

### Interaction with voice onset resets

If voice drops below `voiceThresholdDb` during the onset confirmation period, `voiceStartTimeRef` resets to null. On the next voice detection, `findPreRollStartFrame()` runs again with the current buffer state, computing a fresh pre-roll position. The previous value is overwritten. This is correct -- the scan should always be relative to the most recent voice onset attempt, using the latest buffer contents.

## Todo

### Phase 1: Add `findPreRollStartFrame()` helper function

- [x] Add `SAFETY_MARGIN_MS = 100` constant in `src/hooks/useVoiceMirror.ts` (near existing constants)
- [x] Implement `findPreRollStartFrame()` function in `src/hooks/useVoiceMirror.ts` that takes `chunks`, `totalFrames`, `bufferedFrames`, `sampleRate`, and `silenceThresholdDb` as parameters
- [x] In `findPreRollStartFrame()`, compute `bufferStartFrame` and `safetyMarginFrames` from inputs
- [x] In `findPreRollStartFrame()`, iterate chunks backward calling `computeLevel()` on each chunk
- [x] When a chunk below `silenceThresholdDb` is found, compute `onsetFrame` at the boundary and subtract `safetyMarginFrames`
- [x] Clamp the result to `bufferStartFrame` via `Math.max`
- [x] Handle fallback case (all chunks above silence threshold) by returning `bufferStartFrame`

### Phase 2: Replace fixed pre-roll with dynamic scan in `tickStateMachine()`

- [x] Remove the `PRE_ROLL_MS` constant from `src/hooks/useVoiceMirror.ts`
- [x] Replace the inline pre-roll calculation in the `if (voiceStartTimeRef.current === null)` block with a call to `findPreRollStartFrame(chunksRef.current, totalFramesRef.current, bufferedFramesRef.current, sampleRate, s.silenceThresholdDb)`
- [x] Verify that no other code references `PRE_ROLL_MS`

### Phase 3: Update unit tests

- [x] Add `makeRisingChunk()` helper in `src/hooks/__tests__/useVoiceMirror.test.ts` that produces audio between `SILENCE_THRESHOLD_DB` and `VOICE_THRESHOLD_DB`
- [x] Add test: "captures gradual speech attack by scanning backward to silence threshold" -- feed silent chunks, then rising chunks, then loud chunks, and verify encoded frames include the rising chunks plus safety margin
- [x] Update existing test: "clamps pre-roll to buffer start when buffer is very short" to match new backward-scan fallback behavior (no silent pre-buffer leads to all-above-threshold fallback)
- [x] Run existing pre-roll test ("includes pre-roll audio before voice detection point in encoding") and verify it still passes with the new logic
- [x] Verify all other existing tests in `useVoiceMirror.test.ts` still pass

### Phase 4: Verification

- [x] Run `pnpm typecheck` and confirm no type errors
- [x] Run `pnpm lint` and confirm no lint errors
- [x] Run `pnpm test:ci` and confirm all unit tests pass
