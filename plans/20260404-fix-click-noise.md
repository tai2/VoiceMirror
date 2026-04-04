# Fix Playback Click Noise

## Goal

Eliminate the consistent click noise (estimated 5-10 Hz) that occurs during playback of recorded voice audio. The clicks are present in the raw PCM data delivered by `react-native-audio-api`'s `AudioRecorder` before any encoding takes place, ruling out the AAC encoder as the cause. The built-in Voice Memos app does not exhibit the same noise, ruling out hardware.

## Root Cause Analysis

### Sample rate mismatch triggers lossy resampling in `react-native-audio-api`

The app creates its `AudioContext` at a hardcoded 44100 Hz (`SAMPLE_RATE` constant in `src/constants/audio.ts`), but iOS devices natively operate at 48000 Hz. When the `onAudioReady` callback is registered with `sampleRate: 44100`, the library's `IOSRecorderCallback` detects a mismatch between the hardware input format (48000 Hz) and the requested callback format (44100 Hz), and uses an `AVAudioConverter` to resample on the audio thread.

The resampling path in `IOSRecorderCallback::receiveAudioData` (in `node_modules/react-native-audio-api/ios/audioapi/ios/core/utils/IOSRecorderCallback.mm`) has a subtle frame-count error:

```cpp
// Line 144: ceil() estimates output frame count
size_t outputFrameCount = ceil(numFrames * (sampleRate_ / bufferFormat_.sampleRate));

// Line 169: AVAudioConverter produces the actual frames
[converter_ convertToBuffer:converterOutputBuffer_ error:&error withInputFromBlock:inputBlock];

// Line 170: frameLength is overwritten (stale value, not used downstream but misleading)
converterOutputBuffer_.frameLength = sampleRate_ / bufferFormat_.sampleRate * numFrames;

// Lines 179-183: push outputFrameCount frames, which may exceed actual converter output
circularBus_[i]->push_back(inputChannel, outputFrameCount);
```

The `ceil()` on line 144 can round up by 1 frame beyond what the converter actually produced. When this happens, the last sample pushed into the circular buffer is stale data from the previous conversion's output buffer. This creates a single-sample discontinuity (click) each time the circular buffer emits a 4096-frame block to JavaScript.

At 44100 Hz with 4096-frame emission blocks, the callback fires at ~10.77 Hz -- matching the user's observation of 5-10 Hz clicking.

### Why the fast path has no clicks

When the hardware sample rate matches the requested sample rate, `IOSRecorderCallback` takes a direct path (lines 130-141) that copies input data straight to the circular buffer with no conversion and no frame-count rounding. This path is artifact-free.

## Approach

**Use the device's native sample rate instead of hardcoding 44100 Hz.**

`react-native-audio-api` exposes `AudioManager.getDevicePreferredSampleRate()` which returns the hardware sample rate. When the `AudioContext` is created without a `sampleRate` option, it defaults to this value (see `src/core/AudioContext.ts` line 24 in the library). By removing the hardcoded 44100 Hz, we ensure:

1. The `AudioContext` runs at the hardware sample rate (e.g., 48000 Hz on most iOS devices).
2. The `onAudioReady` callback requests audio at the same rate as the hardware.
3. `IOSRecorderCallback` takes the **direct fast path** (no `AVAudioConverter`, no frame-count rounding).
4. On Android, `AndroidRecorderCallback` similarly bypasses `miniaudio` conversion when rates match.

The AAC encoder in the `audio-encoder` Expo module already accepts a dynamic `sampleRate` parameter -- it passes through to `ExtAudioFileCreateWithURL` (iOS) and `MediaFormat.createAudioFormat` (Android). No changes needed there.

### Changes required

1. **Remove `SAMPLE_RATE` constant** -- it is no longer a compile-time constant since the sample rate is determined at runtime by the device.
2. **`AudioContextProvider`** -- create `AudioContext` without specifying `sampleRate`, letting it default to the device's preferred rate.
3. **`useVoiceMirror`** -- already uses `context.sampleRate` everywhere, so it naturally adapts. No logic changes needed.
4. **`usePlaybackLevelHistory`** -- already reads `audioBuffer.sampleRate`. No changes needed.
5. **`audio.ts` / level computation** -- no dependency on a fixed sample rate. No changes needed.
6. **Tests** -- update default sample rates in stubs if they reference the old constant.

## Code Changes

### 1. Remove the hardcoded `SAMPLE_RATE` constant

**File: `/Users/tai2/VoiceMirror/src/constants/audio.ts`**

```typescript
// Remove this line:
// export const SAMPLE_RATE = 44100;

// Keep only these:
export const LEVEL_HISTORY_SIZE = 40;
export const DB_FLOOR = -70;
export const DB_CEIL = -10;
```

### 2. Use device-native sample rate in `AudioContextProvider`

**File: `/Users/tai2/VoiceMirror/src/context/AudioContextProvider.tsx`**

```typescript
import { createContext, useContext, useEffect, useState } from 'react';
import { AudioContext } from 'react-native-audio-api';

const Ctx = createContext<AudioContext | null>(null);

export function AudioContextProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<AudioContext | null>(null);

  useEffect(() => {
    // Omitting sampleRate lets react-native-audio-api use the device's
    // preferred rate (AudioManager.getDevicePreferredSampleRate()), which
    // avoids sample-rate conversion in the recording callback and the
    // click artifacts it introduces.
    const context = new AudioContext();
    setCtx(context);
    return () => { void context.close(); };
  }, []);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useAudioContext(): AudioContext | null {
  return useContext(Ctx);
}
```

The key change: `new AudioContext({ sampleRate: SAMPLE_RATE })` becomes `new AudioContext()`. The `SAMPLE_RATE` import is removed entirely.

### 3. No changes needed in `useVoiceMirror.ts`

The hook already uses `context.sampleRate` throughout:
- `recorder.onAudioReady({ sampleRate: context.sampleRate, ... })` -- line 177
- `context.createBuffer(1, bufferedFrames, context.sampleRate)` -- line 255
- `tickStateMachine(db, totalFramesRef.current, context.sampleRate)` -- line 206
- Playback offset calculation uses `context.sampleRate` -- line 263

All of these will automatically use the device's native sample rate once the `AudioContext` is created without a hardcoded rate.

### 4. No changes needed in the encoder

The encoder receives `context.sampleRate` at encoding time:
```typescript
encoderService.startEncoding(filePath, context.sampleRate);
```
Both `AudioEncoderModule.swift` and `AudioEncoderModule.kt` use the passed sample rate to configure the AAC output format. They will work correctly with 48000 Hz or any other rate.

### 5. No changes needed in `usePlaybackLevelHistory.ts`

It reads `audioBuffer.sampleRate` from the buffer, which inherits the context's sample rate.

### 6. Update test stubs (optional cleanup)

Test stubs use `sampleRate = 44100` as defaults. These are just default values for tests and don't affect production behavior. They can be left as-is since tests exercise logic, not actual audio hardware. However, for consistency, the default could be changed to 48000 to better reflect typical device behavior:

**File: `/Users/tai2/VoiceMirror/src/__tests__/stubs/stubAudioContext.ts`** (optional)

No functional change required -- the `sampleRate` parameter defaults are only used in test scenarios where the exact value does not matter for correctness.

## File Paths That Need Modification

| File | Change |
|------|--------|
| `/Users/tai2/VoiceMirror/src/constants/audio.ts` | Remove `SAMPLE_RATE` export |
| `/Users/tai2/VoiceMirror/src/context/AudioContextProvider.tsx` | Remove `SAMPLE_RATE` import; create `AudioContext` without `sampleRate` option |

## Considerations and Trade-offs

### Why not patch `react-native-audio-api` instead?

The frame-count rounding bug in `IOSRecorderCallback` could theoretically be fixed in the library. However:
- The library is a third-party dependency; patching it requires maintaining a fork or submitting a PR upstream.
- Using the native sample rate is the correct approach regardless -- it avoids unnecessary computation on the audio thread and produces the highest fidelity audio (no resampling artifacts at all).
- The library's own `AudioContext` defaults to the device sample rate when no `sampleRate` is specified, indicating this is the intended usage pattern.

### Sample rate variability across devices

Different devices may have different native sample rates (48000 Hz is common on iOS, but some devices use 44100 Hz or other rates). By using the device's preferred rate:
- Recording and playback always use the hardware's native rate, avoiding any conversion.
- The AAC encoder handles any standard sample rate correctly.
- Level computation, VAD, and all timing calculations already use `context.sampleRate` dynamically.

### File size impact

At 48000 Hz vs 44100 Hz, recorded M4A files will be ~8.8% larger. AAC at 128 kbps is bitrate-controlled, so the encoded file size difference is negligible. The raw PCM buffer in memory during recording grows by the same 8.8% ratio, from ~10 MB to ~10.9 MB for a 60-second recording. This is acceptable.

### Playback of existing recordings

Existing recordings saved at 44100 Hz will play back correctly because:
- `useRecordings` decodes saved M4A files via `decoderService.decodeAudioData()`, which returns an `AudioBuffer` at whatever sample rate the file was encoded at.
- The `AudioBufferSourceNode` handles sample rate conversion during playback automatically (buffer sample rate vs context sample rate).
- The `react-native-audio-api` playback engine uses its `processWithoutInterpolation` or `processWithInterpolation` methods to handle rate differences at the output stage, which is well-tested and does not suffer from the same boundary artifact issue as the recorder callback.

### E2E test audio path

`E2EAudioRecordingService` delivers audio via WebSocket and does not go through `IOSRecorderCallback`. Its `onAudioReady` config also uses `context.sampleRate`, so it will automatically adapt. No changes needed.

### Minimal change surface

This fix requires modifying only 2 files with a total of about 4 lines changed. The `SAMPLE_RATE` constant is only used in `AudioContextProvider.tsx`, so removing it has no ripple effects beyond that one import site.

## Todo

### Phase 1: Remove hardcoded sample rate constant

- [x] In `src/constants/audio.ts`, remove the `export const SAMPLE_RATE = 44100;` line
- [x] Verify that `LEVEL_HISTORY_SIZE`, `DB_FLOOR`, and `DB_CEIL` exports remain intact

### Phase 2: Update AudioContextProvider to use device-native sample rate

- [x] In `src/context/AudioContextProvider.tsx`, remove the `import { SAMPLE_RATE } from '../constants/audio';` line
- [x] In `src/context/AudioContextProvider.tsx`, change `new AudioContext({ sampleRate: SAMPLE_RATE })` to `new AudioContext()`
- [x] Add a comment explaining why `sampleRate` is intentionally omitted (avoids resampling artifacts)

### Phase 3: Verify no other references to SAMPLE_RATE

- [x] Search the entire `src/` tree for any remaining imports or usages of `SAMPLE_RATE` and confirm none exist
- [x] Confirm `useVoiceMirror.ts` uses `context.sampleRate` (dynamic) and does not reference the removed constant
- [x] Confirm encoder calls pass `context.sampleRate` (not the removed constant)

### Phase 4: Verification

- [x] Run `pnpm typecheck` and confirm no type errors (especially no "cannot find SAMPLE_RATE" errors)
- [x] Run `pnpm lint` and confirm no lint violations
- [x] Run `pnpm test:ci` and confirm all unit tests pass
- [x] Verify test stubs in `src/__tests__/stubs/stubAudioContext.ts` and `src/__tests__/stubs/stubAudioDecoderService.ts` still work (their default `sampleRate = 44100` is a local default, not dependent on the removed constant)
