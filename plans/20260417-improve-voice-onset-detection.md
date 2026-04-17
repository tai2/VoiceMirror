# Improve Voice Onset Detection for Plosive-Initial Words

## Goal

Fix the pre-roll algorithm so that words beginning with a brief plosive burst followed by a sub-silence gap -- such as the Japanese word "kitto" (きっと) -- are captured in full. Currently, the initial "ki" fragment is dropped because:

1. The "ki" burst is too short to satisfy `voiceOnsetMs` (250ms), so voice onset is not confirmed during the burst.
2. Between the "ki" burst and the sustained "tto" portion there is a brief silence gap (the geminate consonant "っ", a glottal stop) where audio drops below `silenceThresholdDb`.
3. When voice onset is eventually confirmed on the "tto" portion, `findPreRollStartFrame` scans backward and stops at the first chunk below `silenceThresholdDb` -- the gap. The initial "ki" burst, which lies _before_ that gap, is excluded from the recording.

The fix: make the backward scan skip over brief silence gaps (shorter than a configurable tolerance) and continue scanning until it finds a _sustained_ silence period, ensuring that isolated plosive bursts preceding short gaps are captured.

## Architecture / Approach

### Problem analysis

The current `findPreRollStartFrame` backward scan terminates on the **first** chunk whose RMS level is below `silenceThresholdDb`. This works well for smooth speech attacks but fails for utterances with a plosive onset followed by a geminate consonant (a silent gap within the word):

```
Timeline (chunks, ~85-93ms each):

  [silent] [silent] [ki-burst] [gap] [tto] [tto] [tto] ...
                                                        ^ voice onset confirmed here

  Current scan:     stops here ──────┘
                    gap is below silenceThresholdDb
                    "ki-burst" is excluded

  Desired scan:     continues through gap
                    stops here ──┘
                    [silent] is true sustained silence
                    "ki-burst" is included
```

The fundamental issue: a single chunk below `silenceThresholdDb` is not necessarily the boundary between speech and true silence. Brief gaps within an utterance (geminate consonants, plosive releases, micro-pauses between syllables) can produce sub-threshold chunks that should be treated as part of the speech, not as the pre-speech silence boundary.

### Proposed approach: gap tolerance in backward scan

Introduce a **gap tolerance** parameter that specifies the maximum duration (in milliseconds) of consecutive sub-threshold chunks that should be "bridged" rather than treated as the onset boundary. The backward scan continues through short silence gaps, only terminating when it encounters a silence region longer than the tolerance.

```
  [silent] [silent] [ki-burst] [gap] [tto] [tto] [tto]
                                                       ^ scan starts here

  Step 1: [tto]  -> above threshold -> continue
  Step 2: [tto]  -> above threshold -> continue
  Step 3: [tto]  -> above threshold -> continue
  Step 4: [gap]  -> below threshold -> start counting gap: 1 chunk (~85ms)
                    gap (85ms) < tolerance (200ms) -> continue scanning
  Step 5: [ki-burst] -> above threshold -> gap was short, reset gap counter
                         this is speech, continue scanning
  Step 6: [silent] -> below threshold -> start counting gap: 1 chunk
  Step 7: [silent] -> below threshold -> gap: 2 chunks (~170ms)
                    still under tolerance, but we reach the onset boundary...
                    Actually let's check: 170ms < 200ms. But 3 silent chunks would be 255ms > 200ms.

  With 2 silent chunks the function continues further, but there are no more chunks.
  -> Falls back to bufferStartFrame (includes everything).
```

In a more realistic scenario with sufficient silent buffer preceding, the scan reaches a sustained silence region (several consecutive chunks below threshold, exceeding the gap tolerance) and returns that as the onset boundary:

```
  [...] [silent] [silent] [silent] [ki-burst] [gap] [tto] [tto] [tto]

  Backward scan reaches [gap]: 1 chunk silence (85ms < 200ms tolerance) -> bridge
  Continues to [ki-burst]: above threshold -> speech, reset gap counter
  Continues to [silent]: 1 chunk silence
  Continues to [silent]: 2 chunks silence (170ms < 200ms) -> continue
  Continues to [silent]: 3 chunks silence (255ms > 200ms) -> SUSTAINED SILENCE FOUND

  Onset boundary: first chunk after sustained silence region = [ki-burst]
  Pre-roll frame = onset of [ki-burst] - safety margin (100ms)
```

### Why gap tolerance instead of alternatives

**Alternative 1: Lower the silence threshold for pre-roll scan.** This would reduce the threshold so that plosive gaps stay above it. But plosive gaps can be genuinely near-silent (the "っ" glottal stop is a true cessation of phonation), so lowering the threshold would have to go very low, risking inclusion of excessive ambient noise in the pre-roll.

**Alternative 2: Increase the safety margin beyond 100ms.** Simply making the margin larger (e.g., 400ms) would blindly include more audio before any detected boundary. This works for some cases but wastes pre-roll budget on true silence and does not adapt to varying gap lengths.

**Alternative 3: Use a separate "pre-roll onset threshold" lower than `silenceThresholdDb`.** Adds a new user-facing setting that is hard to reason about and tune.

The gap tolerance approach is the most principled: it directly models the linguistic reality that brief silences within a word are not word boundaries. The tolerance value maps to a phonological concept (maximum duration of intra-word silence), making it easy to reason about and tune.

### Choosing the gap tolerance value

In Japanese phonology, geminate consonants (っ) typically last 100-200ms. Other languages have similar intra-word silence phenomena (English stop consonants, aspiration gaps). A tolerance of **200ms** provides comfortable coverage:

- At 48kHz with 4096-frame chunks (~85ms each): 200ms spans ~2.3 chunks, so gaps of up to 2 chunks are bridged.
- At 44.1kHz with 4096-frame chunks (~93ms each): 200ms spans ~2.15 chunks, so gaps of up to 2 chunks are bridged.

This is conservative enough to bridge intra-word gaps while still recognizing true inter-word silence (which is typically 300ms+ for natural pauses). The tolerance will be a module-level constant `GAP_TOLERANCE_MS = 200`, placed alongside the existing `SAFETY_MARGIN_MS = 100`.

### Algorithm changes

The updated `findPreRollStartFrame` tracks consecutive silence chunks during the backward scan. When it encounters a below-threshold chunk, instead of immediately returning, it records the potential onset boundary and continues scanning. If the accumulated silence gap exceeds the tolerance, the scan terminates at the onset boundary identified at the start of that gap. If a chunk above the threshold is encountered before the tolerance is exceeded, the gap counter resets and scanning continues.

The function needs to track:

- `gapFrames`: accumulated frames of consecutive sub-threshold chunks during backward traversal
- `gapToleranceFrames`: maximum allowed gap frames (derived from `GAP_TOLERANCE_MS`)
- `lastOnsetFrame`: the onset boundary at the beginning of the current gap (used when the gap exceeds tolerance)

## Code Changes

### 1. Update `findPreRollStartFrame()` with gap tolerance

**File: `/Users/tai2/VoiceMirror/src/hooks/useVoiceMirror.ts`**

Add the new constant:

```typescript
const SAFETY_MARGIN_MS = 100;
const GAP_TOLERANCE_MS = 200;
```

Replace the existing `findPreRollStartFrame` function:

```typescript
function findPreRollStartFrame(
  chunks: Float32Array[],
  totalFrames: number,
  bufferedFrames: number,
  sampleRate: number,
  silenceThresholdDb: number,
): number {
  const bufferStartFrame = totalFrames - bufferedFrames;
  const safetyMarginFrames = Math.round((SAFETY_MARGIN_MS / 1000) * sampleRate);
  const gapToleranceFrames = Math.round((GAP_TOLERANCE_MS / 1000) * sampleRate);

  let framesToEnd = 0;
  let gapFrames = 0;
  // Track the onset boundary at the start of the current gap.
  // When we first encounter a below-threshold chunk while scanning backward,
  // the onset is at the chunk *after* this one (the most recent above-threshold
  // chunk). We record that boundary and keep scanning. If the gap exceeds
  // the tolerance, we use this boundary.
  let lastOnsetFrame: number | null = null;

  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const { db } = computeLevel(chunk, 0, chunk.length);
    framesToEnd += chunk.length;

    if (db < silenceThresholdDb) {
      // Below silence threshold. Could be an intra-word gap or true silence.
      if (lastOnsetFrame === null) {
        // First silent chunk in this gap region -- record the onset boundary.
        // The onset is at the start of the next chunk (i+1), which is the
        // most recent above-threshold chunk.
        lastOnsetFrame = totalFrames - framesToEnd + chunk.length;
      }
      gapFrames += chunk.length;

      if (gapFrames > gapToleranceFrames) {
        // Sustained silence found -- this is the true pre-speech boundary.
        const preRollFrame = lastOnsetFrame - safetyMarginFrames;
        return Math.max(bufferStartFrame, preRollFrame);
      }
    } else {
      // Above silence threshold -- this is speech/noise.
      // Reset the gap tracking: any gap we were accumulating was short
      // enough to be intra-word silence.
      gapFrames = 0;
      lastOnsetFrame = null;
    }
  }

  // Reached the beginning of the buffer without finding sustained silence.
  // If we were in the middle of a gap, use the onset boundary if the gap
  // tolerance was exceeded. Otherwise, include the entire buffer.
  if (lastOnsetFrame !== null && gapFrames > gapToleranceFrames) {
    const preRollFrame = lastOnsetFrame - safetyMarginFrames;
    return Math.max(bufferStartFrame, preRollFrame);
  }

  return bufferStartFrame;
}
```

Key differences from the current implementation:

- Instead of returning immediately when `db < silenceThresholdDb`, the function records the onset boundary and accumulates `gapFrames`.
- Only when `gapFrames > gapToleranceFrames` does it return -- this means brief gaps (up to 200ms / ~2 chunks) are bridged.
- When an above-threshold chunk is encountered after a short gap, `gapFrames` and `lastOnsetFrame` are reset, and scanning continues backward.
- The fallback (no sustained silence found) still returns `bufferStartFrame`, identical to the current behavior.

### 2. Update unit tests

**File: `/Users/tai2/VoiceMirror/src/hooks/__tests__/useVoiceMirror.test.ts`**

Add a new test case that verifies plosive-initial words with intra-word gaps are captured. This test simulates the "kitto" pattern: silent chunks, a brief loud burst (ki), a silent gap (geminate consonant), then sustained loud chunks (tto) that trigger onset:

```typescript
it("bridges brief intra-word silence gaps to capture plosive onsets like 'kitto'", async () => {
  const { recordingService, encoderService } = await setupWithPermission();

  // Background silence (sustained)
  act(() => {
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeSilentChunk());
    }
  });

  // Brief plosive burst ("ki") - above voice threshold but too short for onset
  act(() => {
    jest.advanceTimersByTime(100);
    recordingService.recorder.simulateChunk(makeLoudChunk());
  });

  // Intra-word silence gap (geminate consonant "っ") - 1 chunk, below gap tolerance
  act(() => {
    jest.advanceTimersByTime(100);
    recordingService.recorder.simulateChunk(makeSilentChunk());
  });

  // Sustained voice ("tto") - triggers voice onset detection
  act(() => {
    simulateVoiceOnset(recordingService);
  });

  const totalEncodedFrames = encoderService.encodeChunk.mock.calls.reduce(
    (sum: number, [chunk]: [Float32Array]) => sum + chunk.length,
    0,
  );

  // The encoded audio should include:
  // - The "ki" burst chunk (100ms) that preceded the gap
  // - The gap chunk (100ms)
  // - The voice onset chunks (~250ms+)
  // - Safety margin audio (100ms into the silence before "ki")
  // Total should be significantly more than just the voice onset portion.
  const voiceOnsetFrames = Math.round((VOICE_ONSET_MS / 1000) * 44100);
  const burstAndGapFrames = 2 * Math.round((100 / 1000) * 44100);
  expect(totalEncodedFrames).toBeGreaterThan(
    voiceOnsetFrames + burstAndGapFrames,
  );
});
```

Update the existing "captures gradual speech attack" test description for clarity, since it tests the rising-chunk scenario which is still valid (the rising chunks are above `silenceThresholdDb` so no gap bridging is needed -- the behavior is unchanged from the current algorithm).

Add a test that verifies long silence gaps are NOT bridged (so we don't accidentally include too much pre-speech audio):

```typescript
it("does not bridge silence gaps longer than the gap tolerance", async () => {
  const { recordingService, encoderService } = await setupWithPermission();

  // Background silence
  act(() => {
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeSilentChunk());
    }
  });

  // A loud burst (some noise or false start)
  act(() => {
    jest.advanceTimersByTime(100);
    recordingService.recorder.simulateChunk(makeLoudChunk());
  });

  // Long silence gap (3 chunks = 300ms, exceeds 200ms gap tolerance)
  act(() => {
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeSilentChunk());
    }
  });

  // Voice onset
  act(() => {
    simulateVoiceOnset(recordingService);
  });

  const totalEncodedFrames = encoderService.encodeChunk.mock.calls.reduce(
    (sum: number, [chunk]: [Float32Array]) => sum + chunk.length,
    0,
  );

  // The loud burst before the long gap should NOT be included.
  // Encoded audio should be approximately: voice onset (~250ms+) + safety margin (100ms)
  // The 3-chunk gap exceeds tolerance, so the onset boundary is set at the
  // end of the gap, not bridged to include the earlier burst.
  const voiceOnsetFrames = Math.round((VOICE_ONSET_MS / 1000) * 44100);
  const burstAndGapFrames =
    Math.round((100 / 1000) * 44100) + 3 * Math.round((100 / 1000) * 44100);
  expect(totalEncodedFrames).toBeLessThan(voiceOnsetFrames + burstAndGapFrames);
});
```

## File Paths That Need Modification

| File                                                                 | Change                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/Users/tai2/VoiceMirror/src/hooks/useVoiceMirror.ts`                | Add `GAP_TOLERANCE_MS` constant; rewrite `findPreRollStartFrame()` to bridge short silence gaps |
| `/Users/tai2/VoiceMirror/src/hooks/__tests__/useVoiceMirror.test.ts` | Add test for plosive onset with intra-word gap bridging; add test for long gap non-bridging     |

## Considerations and Trade-offs

### Gap tolerance value selection (200ms)

The 200ms tolerance is based on phonological data for Japanese geminate consonants (typically 100-200ms) and English stop consonant gaps (typically 50-150ms). At chunk granularity (~85-93ms), 200ms corresponds to approximately 2 chunks. This means:

- 1-chunk gaps (~85-93ms): always bridged -- covers most plosive releases and geminate consonants
- 2-chunk gaps (~170-186ms): always bridged -- covers longer geminate consonants
- 3-chunk gaps (~255-279ms): never bridged -- treated as true silence boundaries

The 200ms value could be made a user-configurable setting, but this adds complexity for a niche use case. A fixed constant is simpler and should work well for the vast majority of languages and speaking styles. If needed in the future, it can be promoted to `DetectionSettings`.

### Interaction with `voiceOnsetMs` reset

The current behavior resets `voiceStartTimeRef` when audio drops below `voiceThresholdDb` during onset confirmation. This means the "ki" burst in "kitto" does trigger onset detection, but the detection resets when the gap occurs, and restarts when "tto" begins. The `findPreRollStartFrame` is called fresh when "tto" triggers onset -- at that point, both the "ki" burst and the gap are in the buffer and the updated backward scan bridges the gap correctly.

This interaction is correct: the gap tolerance in `findPreRollStartFrame` compensates for the onset timer reset caused by the gap, without needing to change the onset detection logic itself.

### No change to voice onset confirmation logic

An alternative approach would be to make the onset timer itself tolerant of brief gaps (not resetting `voiceStartTimeRef` when audio drops below threshold for short periods). This was considered but rejected because:

1. It would make the onset detector less precise, potentially triggering on ambient noise patterns that briefly cross the threshold
2. The onset detector and pre-roll scanner serve different purposes -- onset detection should be strict (avoiding false triggers), while pre-roll should be generous (avoiding clipping)
3. Changing the onset timer would affect the timing of when recording starts, not just what pre-roll audio is included

### `speechMs` inflation remains acceptable

With gap bridging, `voiceStartFrameRef` may now point further back than before (by the duration of the bridged gap plus the additional speech burst before it). This increases the `speechMs` inflation. For a "kitto" pattern with a 100ms burst + 100ms gap, the inflation increases by ~200ms compared to the non-bridged case.

This means the effective `minRecordingMs` guard could be as low as `500ms - 400ms (pre-roll) - 200ms (bridged gap) = -100ms`, meaning any speech after onset confirmation would satisfy it. This is acceptable: a plosive-initial utterance that triggers onset confirmation is genuine speech, not an accidental noise.

### Performance: no meaningful change

The backward scan still iterates through chunks calling `computeLevel()`. The gap bridging logic adds trivial bookkeeping (tracking `gapFrames` and `lastOnsetFrame`) but does not increase the number of chunks scanned. In the worst case, the scan still traverses the entire 30-second buffer, same as before.

### Existing tests remain valid

The existing pre-roll tests use patterns that are unaffected by gap bridging:

- **"includes pre-roll audio before voice detection point in encoding"**: Uses 5 silent chunks (sustained silence, well over the 200ms gap tolerance) followed by loud chunks. The backward scan still finds the sustained silence boundary at the same position.
- **"clamps pre-roll to buffer start when buffer is very short"**: All chunks are loud (above threshold), so the gap bridging logic is never triggered. Falls back to `bufferStartFrame` as before.
- **"captures gradual speech attack by scanning backward to silence threshold"**: Rising chunks are above `silenceThresholdDb`, so they are treated as speech, not gaps. The backward scan continues through them as before, eventually finding the silent chunks. Behavior is identical.

### Edge case: scan starts with a gap

If the most recent chunks (closest to the detection point) are below `silenceThresholdDb`, the algorithm correctly tracks them as a potential gap. If they are followed by above-threshold chunks further back, the gap is bridged. If no above-threshold chunks are found within the tolerance, the gap boundary becomes the onset point. This handles the unlikely case where voice onset is confirmed but the very latest chunk happens to be below threshold (e.g., due to chunk boundary alignment).

### Edge case: multiple gaps

A word might have multiple intra-word gaps (e.g., a word with two geminate consonants). Each gap is evaluated independently. As long as each individual gap is shorter than the tolerance, all gaps are bridged and the scan continues. The onset boundary is set at the first sustained silence region that exceeds the tolerance.

```
  [silent x3] [burst] [gap] [burst] [gap] [sustained voice]
                                                            ^ detection

  Scan: gap (1 chunk) -> bridge -> burst -> speech ->
        gap (1 chunk) -> bridge -> burst -> speech ->
        silent x3 (255ms > 200ms) -> SUSTAINED SILENCE -> onset boundary at [burst]
```

## Todo

### Phase 1: Update `findPreRollStartFrame()` with gap tolerance

- [x] Add `GAP_TOLERANCE_MS = 200` constant next to existing `SAFETY_MARGIN_MS` in `src/hooks/useVoiceMirror.ts`
- [x] Compute `gapToleranceFrames` from `GAP_TOLERANCE_MS` and `sampleRate` at the start of `findPreRollStartFrame`
- [x] Add `gapFrames` accumulator variable (initialized to 0) to track consecutive sub-threshold frames during backward scan
- [x] Add `lastOnsetFrame` variable (initialized to null) to record the onset boundary at the start of each gap
- [x] Replace immediate return on `db < silenceThresholdDb` with gap accumulation logic: record `lastOnsetFrame` on first silent chunk, increment `gapFrames` by `chunk.length`
- [x] Add sustained silence check: when `gapFrames > gapToleranceFrames`, return `Math.max(bufferStartFrame, lastOnsetFrame - safetyMarginFrames)`
- [x] Add gap reset logic: when `db >= silenceThresholdDb`, reset `gapFrames` to 0 and `lastOnsetFrame` to null
- [x] Update the fallback at end of loop: if `lastOnsetFrame !== null && gapFrames > gapToleranceFrames`, return clamped onset; otherwise return `bufferStartFrame`

### Phase 2: Add unit tests

- [x] Add test case: "bridges brief intra-word silence gaps to capture plosive onsets like 'kitto'" — simulate 5 silent chunks, 1 loud burst, 1 silent gap chunk, then voice onset; verify encoded frames include the burst and gap
- [x] Add test case: "does not bridge silence gaps longer than the gap tolerance" — simulate 5 silent chunks, 1 loud burst, 3 silent gap chunks (300ms > 200ms tolerance), then voice onset; verify encoded frames exclude the earlier burst
- [x] Verify existing test "includes pre-roll audio before voice detection point in encoding" still passes (sustained silence pattern unchanged)
- [x] Verify existing test "clamps pre-roll to buffer start when buffer is very short" still passes (all-loud pattern unchanged)
- [x] Verify existing test "captures gradual speech attack by scanning backward to silence threshold" still passes (rising chunks above threshold, no gap bridging triggered)

### Phase 3: Verification

- [x] Run `pnpm typecheck` and confirm no type errors
- [x] Run `pnpm lint` and confirm no lint errors
- [x] Run `pnpm test:ci` and confirm all unit tests pass (existing + new)
