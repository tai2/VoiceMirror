# Threshold Guides on Level Meter -- Implementation Plan

## Goal

Help users adjust voice and silence detection settings by showing real-time visual feedback on the main screen's audio level meter during the "idle" and "recording" phases:

1. **Current dB as a number** -- display the current raw dB value so users can see exactly where ambient noise and speech levels fall.
2. **Voice threshold guide line** -- a horizontal line on the meter graph showing where `voiceThresholdDb` sits, so users can see when their speech crosses the trigger level.
3. **Silence threshold guide line** -- a second horizontal line showing where `silenceThresholdDb` sits, so users can see the cutoff that ends recording.

These guides only appear during `idle` and `recording` phases (when the microphone is active and the thresholds are relevant). During `playing` and `paused` phases they are hidden.

## Architecture / Approach

### Exposing raw dB from useVoiceMirror

Currently, `useVoiceMirror` computes the raw dB value inside the `onAudioReady` callback (lines 205-208 of `src/hooks/useVoiceMirror.ts`) but does not expose it as state. We need to add a `currentDb` state value that gets updated on every audio chunk during idle and recording phases.

To avoid the duplicated RMS computation noted in `research.md` (issue #1), we refactor `computeNormalizedLevel` in `src/lib/audio.ts` to also return the raw dB. We introduce a new function `computeLevel` that returns both `{ normalized, db }` and rewrite `computeNormalizedLevel` as a thin wrapper.

"Remove `computeNormalizedLevel` and refactor all the existing callers"

```typescript
// src/lib/audio.ts

export type LevelResult = {
  normalized: number;
  db: number;
};

export function computeLevel(
  samples: Float32Array,
  startFrame: number,
  numFrames: number,
): LevelResult {
  let sumSq = 0;
  const end = startFrame + numFrames;
  for (let i = startFrame; i < end; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / numFrames);
  const db = 20 * Math.log10(Math.max(rms, 1e-10));
  const normalized = Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
  return { normalized, db };
}

export function computeNormalizedLevel(
  samples: Float32Array,
  startFrame: number,
  numFrames: number,
): number {
  return computeLevel(samples, startFrame, numFrames).normalized;
}
```

This preserves backward compatibility -- all existing callers of `computeNormalizedLevel` continue to work unchanged. The new `computeLevel` function is used only inside `useVoiceMirror`'s `onAudioReady` callback.

### Adding currentDb to VoiceMirrorState

In `src/hooks/types.ts`, add `currentDb` to `VoiceMirrorState`:

```typescript
export type VoiceMirrorState = {
  phase: Phase;
  levelHistory: number[];
  currentDb: number | null;  // <-- new: raw dB from latest chunk, null when not monitoring
  hasPermission: boolean;
  permissionDenied: boolean;
  recordingError: string | null;
  togglePause: () => void;
  suspendForListPlayback: () => Promise<void>;
  resumeFromListPlayback: () => Promise<void>;
};
```

Using `number | null` lets the UI distinguish "no data yet" (paused/playing) from an actual dB reading.

### Updating useVoiceMirror to emit currentDb

In `src/hooks/useVoiceMirror.ts`:

1. Add a `currentDb` state:

```typescript
const [currentDb, setCurrentDb] = useState<number | null>(null);
```

2. Replace the dual computation in the `onAudioReady` callback with a single `computeLevel` call:

```typescript
// Before (lines 202-209):
const normalized = computeNormalizedLevel(chunk, 0, numFrames);
setLevelHistory(prev => [...prev.slice(1), normalized]);

let sumSq = 0;
for (let i = 0; i < numFrames; i++) sumSq += chunk[i] * chunk[i];
const rms = Math.sqrt(sumSq / numFrames);
const db = 20 * Math.log10(Math.max(rms, 1e-10));
tickStateMachine(db, totalFramesRef.current, context.sampleRate);

// After:
const { normalized, db } = computeLevel(chunk, 0, numFrames);
setLevelHistory(prev => [...prev.slice(1), normalized]);
setCurrentDb(db);
tickStateMachine(db, totalFramesRef.current, context.sampleRate);
```

This eliminates the duplicated RMS computation and ensures the displayed dB and the VAD dB are always identical.

3. Clear `currentDb` when entering non-monitoring phases:

In `pauseMonitoring()`, add:
```typescript
setCurrentDb(null);
```

In `stopAndPlay()` (when transitioning to playing), the recorder stops producing chunks so `currentDb` will retain its last value. Set it to null explicitly at the start of `stopAndPlay()`:
```typescript
setCurrentDb(null);
```

In `startMonitoring()`, the initial state is already handled since the first chunk callback will set `currentDb`.

4. Return `currentDb` from the hook:

```typescript
return {
  phase,
  levelHistory,
  currentDb,   // <-- new
  hasPermission,
  permissionDenied,
  recordingError,
  togglePause,
  suspendForListPlayback,
  resumeFromListPlayback,
};
```

### Converting threshold dB to normalized position

The `AudioLevelMeter` renders bars with height proportional to normalized values (0-1). The threshold guide lines need to be positioned at the same scale. The conversion formula is the same one used in `computeNormalizedLevel`:

```
normalizedPosition = clamp((thresholdDb - DB_FLOOR) / (DB_CEIL - DB_FLOOR), 0, 1)
```

For the default settings:
- `voiceThresholdDb` (-35 dB) maps to `(-35 - (-70)) / (-10 - (-70))` = `35/60` = ~0.583
- `silenceThresholdDb` (-45 dB) maps to `(-45 - (-70)) / (-10 - (-70))` = `25/60` = ~0.417

These positions are calculated in the `AudioLevelMeter` component (since it owns the height constants) and rendered as horizontal guide lines.

### Adding a dB-to-normalized helper

Add a small utility to `src/lib/audio.ts`:

```typescript
export function dbToNormalized(db: number): number {
  return Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
}
```

This is used by `AudioLevelMeter` to position the guide lines. It could also be used to simplify `computeLevel`, but for clarity we keep them separate (the per-sample RMS loop is performance-sensitive).

### Modifying AudioLevelMeter

The `AudioLevelMeter` component in `src/components/AudioLevelMeter.tsx` needs several changes:

1. Accept new props for thresholds and current dB.
2. Render two horizontal guide lines (voice threshold and silence threshold).
3. Render a current dB text label.
4. Only show guides during `idle` and `recording` phases.

Updated props type:

```typescript
type Props = {
  history: number[];
  phase: Phase;
  currentDb: number | null;
  voiceThresholdDb: number;
  silenceThresholdDb: number;
};
```

Updated component:

```typescript
import { View, Text, StyleSheet } from 'react-native';
import type { Phase } from '../hooks/types';
import { dbToNormalized } from '../lib/audio';

const BAR_WIDTH = 4;
const BAR_GAP = 3;
const MAX_HEIGHT = 100;
const MIN_HEIGHT = 4;

const PHASE_COLOR: Record<Phase, string> = {
  idle: '#3B82F6',
  recording: '#EF4444',
  playing: '#22C55E',
  paused: '#52525B',
};

const PHASE_GLOW: Record<Phase, string> = {
  idle: 'rgba(59, 130, 246, 0.4)',
  recording: 'rgba(239, 68, 68, 0.4)',
  playing: 'rgba(34, 197, 94, 0.4)',
  paused: 'rgba(82, 82, 91, 0.2)',
};

const VOICE_THRESHOLD_COLOR = 'rgba(239, 68, 68, 0.6)';    // red-ish
const SILENCE_THRESHOLD_COLOR = 'rgba(251, 191, 36, 0.6)';  // amber-ish

type Props = {
  history: number[];
  phase: Phase;
  currentDb: number | null;
  voiceThresholdDb: number;
  silenceThresholdDb: number;
};

export function AudioLevelMeter({ history, phase, currentDb, voiceThresholdDb, silenceThresholdDb }: Props) {
  const color = PHASE_COLOR[phase];
  const glowColor = PHASE_GLOW[phase];
  const isPaused = phase === 'paused';
  const showGuides = phase === 'idle' || phase === 'recording';

  const voiceNormalized = dbToNormalized(voiceThresholdDb);
  const silenceNormalized = dbToNormalized(silenceThresholdDb);

  // Guide lines are positioned from the bottom of the container.
  // The bars are vertically centered (alignItems: 'center'), so a bar of
  // height h occupies the vertical center. Guide lines use 'bottom' positioning
  // relative to the container to match bar growth direction.
  //
  // Bars grow from the center outward (due to alignItems: 'center'). To make
  // guide lines correspond to bar heights, we position them from the vertical
  // center of the container. A normalized value of N corresponds to a bar
  // height of max(MIN_HEIGHT, N * MAX_HEIGHT). The guide line should be at the
  // same visual height.
  //
  // Since bars are centered vertically in a MAX_HEIGHT container, the bottom of
  // a bar of height h is at (MAX_HEIGHT - h) / 2 from the container bottom.
  // The top of that bar is at (MAX_HEIGHT + h) / 2 from the container bottom.
  // The guide line should mark the top of the bar at that threshold.
  //
  // topFromBottom = (MAX_HEIGHT + thresholdHeight) / 2
  // bottomOffset  = MAX_HEIGHT - topFromBottom = (MAX_HEIGHT - thresholdHeight) / 2

  const voiceHeight = Math.max(MIN_HEIGHT, voiceNormalized * MAX_HEIGHT);
  const silenceHeight = Math.max(MIN_HEIGHT, silenceNormalized * MAX_HEIGHT);

  // Position from the top of the container (for absolute positioning).
  // Bar top = (MAX_HEIGHT - barHeight) / 2, which is also the guide's 'top'.
  const voiceTop = (MAX_HEIGHT - voiceHeight) / 2;
  const silenceTop = (MAX_HEIGHT - silenceHeight) / 2;

  return (
    <View style={styles.container}>
      <View style={[styles.glowBackground, { backgroundColor: glowColor }]} />

      {showGuides && (
        <>
          <View
            style={[
              styles.guideLine,
              { top: voiceTop, borderColor: VOICE_THRESHOLD_COLOR },
            ]}
          />
          <View
            style={[
              styles.guideLine,
              { top: silenceTop, borderColor: SILENCE_THRESHOLD_COLOR },
            ]}
          />
        </>
      )}

      {history.map((value, i) => {
        const normalizedValue = isPaused ? 0.1 : value;
        const height = Math.max(MIN_HEIGHT, normalizedValue * MAX_HEIGHT);
        const opacity = isPaused ? 0.4 : 0.5 + value * 0.5;

        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                backgroundColor: color,
                height,
                opacity,
              },
            ]}
          />
        );
      })}

      {showGuides && currentDb !== null && (
        <View style={styles.dbLabelContainer}>
          <Text style={styles.dbLabel}>
            {Math.round(currentDb)} dB
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: MAX_HEIGHT,
    gap: BAR_GAP,
    paddingHorizontal: 16,
    position: 'relative',
  },
  glowBackground: {
    position: 'absolute',
    top: '20%',
    left: 0,
    right: 0,
    bottom: '20%',
    borderRadius: 40,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: 3,
  },
  guideLine: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    zIndex: 1,
  },
  dbLabelContainer: {
    position: 'absolute',
    top: -20,
    right: 16,
  },
  dbLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A1A1AA',
    fontVariant: ['tabular-nums'],
  },
});
```

### Positioning logic for guide lines

The bars in the current meter use `alignItems: 'center'` on the container, which means bars grow symmetrically upward and downward from the vertical center. A bar at normalized value `v` has height `max(MIN_HEIGHT, v * MAX_HEIGHT)`. Since the container height is `MAX_HEIGHT` (100px), a bar of height `h` has its top edge at `(MAX_HEIGHT - h) / 2` from the top of the container.

The guide lines are positioned with `position: 'absolute'` and a `top` value calculated the same way: for the voice threshold at normalized 0.583, the bar height would be 58.3px, so `top = (100 - 58.3) / 2 = 20.85px`. This places the dashed line exactly at the height a bar would reach when the audio is at the threshold level.

### Showing dB as a formatted number

The `currentDb` value is displayed as `Math.round(currentDb)` with " dB" suffix. Rounding avoids distracting decimal jitter. The label uses `fontVariant: ['tabular-nums']` so the width stays stable as digits change. It is positioned in the top-right corner of the meter, above the bars, so it does not overlap with the bar visualization.

### Wiring through VoiceMirrorScreen

In `src/screens/VoiceMirrorScreen.tsx`, pass the new data from `useVoiceMirror` and `useSettings` to the meter:

```typescript
// Destructure currentDb from useVoiceMirror:
const {
  phase,
  levelHistory,
  currentDb,        // <-- new
  hasPermission,
  permissionDenied,
  recordingError,
  togglePause,
  suspendForListPlayback,
  resumeFromListPlayback,
} = useVoiceMirror(/* ... */);

// In JSX:
<AudioLevelMeter
  history={activeLevelHistory}
  phase={meterPhase}
  currentDb={isListPlaying ? null : currentDb}
  voiceThresholdDb={settings.voiceThresholdDb}
  silenceThresholdDb={settings.silenceThresholdDb}
/>
```

When the recordings list is playing, `currentDb` is passed as `null` which suppresses the dB label and guide lines (since `meterPhase` will be `'playing'`, the `showGuides` check also hides them).

### Updating translations

No new translation keys are needed. The "dB" unit label is universal and does not require localization. The guide lines are purely visual with no text labels.

## File Paths That Need Modification

| File | Change |
|------|--------|
| `src/lib/audio.ts` | Add `LevelResult` type, `computeLevel()` function, `dbToNormalized()` function; keep `computeNormalizedLevel()` as a wrapper |
| `src/hooks/types.ts` | Add `currentDb: number \| null` to `VoiceMirrorState` |
| `src/hooks/useVoiceMirror.ts` | Add `currentDb` state; replace dual RMS computation with single `computeLevel()` call; set `currentDb` to null on pause/play; return `currentDb` |
| `src/components/AudioLevelMeter.tsx` | Add props for `currentDb`, `voiceThresholdDb`, `silenceThresholdDb`; render guide lines and dB label; conditionally show only in idle/recording |
| `src/screens/VoiceMirrorScreen.tsx` | Destructure `currentDb` from `useVoiceMirror`; pass threshold/dB props to `AudioLevelMeter` |
| `src/lib/__tests__/audio.test.ts` | Add tests for `computeLevel()` and `dbToNormalized()` |
| `src/components/__tests__/AudioLevelMeter.test.tsx` | Add tests for guide line rendering and dB label visibility per phase |
| `src/hooks/__tests__/useVoiceMirror.test.ts` | Add tests for `currentDb` state: updates on audio chunks, resets to null on pause/play |
| `src/i18n/locales/en/translation.json` | No changes needed |
| `src/i18n/locales/ja/translation.json` | No changes needed |

## Considerations and Trade-offs

### Why show guides only in idle and recording?

During `playing`, the meter shows playback levels which are not compared against detection thresholds -- the thresholds are irrelevant to playback. During `paused`, all bars are forced to a uniform 0.1 height, so threshold lines would be visually confusing with no real-time data to compare against. Showing guides only when the microphone is active (idle/recording) gives them clear meaning.

### dB update frequency and React state overhead

`setCurrentDb(db)` fires on every audio chunk (~every 93ms). This is the same frequency as the existing `setLevelHistory` call, so it adds one more state update per tick. Since React batches state updates triggered from the same synchronous callback, `setCurrentDb` and `setLevelHistory` will be batched into a single re-render. The overhead is negligible.

### Why round the dB display?

Raw dB values have many decimal places (e.g., -42.7361...) and change rapidly. Showing decimals causes visual jitter that is hard to read. `Math.round()` produces stable integer values that are easier to scan. The integer precision is sufficient for threshold-adjustment purposes -- users need to see "my ambient noise sits around -50 dB" and "my speech peaks around -25 dB", not sub-decibel precision.

### Dashed line rendering on React Native

React Native's `borderStyle: 'dashed'` is supported on both iOS and Android for `View` borders. Using `borderTopWidth: 1` with `height: 0` creates a thin dashed line. This approach avoids needing SVG or custom drawing. The dashed style helps distinguish the guide lines from the solid bars visually.

### Color choices for guide lines

The voice threshold line uses a red-ish color (`rgba(239, 68, 68, 0.6)`) to associate it with the recording phase (voice detection leads to recording). The silence threshold line uses an amber/yellow color (`rgba(251, 191, 36, 0.6)`) to provide clear visual separation from the voice line. Both use 60% opacity so they are visible but do not overpower the bars.

### Backward compatibility of computeNormalizedLevel

The existing `computeNormalizedLevel` function is used in two places: `useVoiceMirror.ts` (line 202) and `usePlaybackLevelHistory.ts` (line 43). The playback path only needs the normalized value, not the raw dB. By keeping `computeNormalizedLevel` as a thin wrapper around `computeLevel`, the playback path continues to work unchanged with no API change.

### Guide line alignment with bar heights

The bars use `alignItems: 'center'` on the container, which centers them vertically. This means bars "grow" symmetrically from the middle. The guide lines must be positioned to match: a guide at normalized value `v` should be at the same vertical position as the top edge of a bar at height `v * MAX_HEIGHT`. The formula `top = (MAX_HEIGHT - barHeight) / 2` achieves this alignment.

### Performance of dbToNormalized

The `dbToNormalized` function is called twice per render (once for each threshold). These values only change when the user adjusts settings, so they could be memoized. However, the computation is trivially cheap (two subtractions, a division, and two clamps) so memoization would add more complexity than it saves. If the thresholds were to be animated in the future, the function is fast enough to run every frame.

### Absence of threshold labels on the guide lines

The guide lines do not have inline text labels (like "Voice" or "Silence") because the meter area is compact (100px tall, ~280px wide with 40 bars). Adding text labels would either crowd the bars or require expanding the component size. The color coding (red = voice, amber = silence) provides sufficient distinction. Users who want to know the exact threshold values can check the Settings screen, which already shows them with descriptions.

## Todo

### Phase 1: Refactor audio utility to expose raw dB

- [x] Add `LevelResult` type (`{ normalized: number; db: number }`) to `src/lib/audio.ts`
- [x] Add `computeLevel()` function to `src/lib/audio.ts` that returns `LevelResult`
- [x] Rewrite `computeNormalizedLevel()` as a thin wrapper that calls `computeLevel().normalized`
- [x] Add `dbToNormalized()` helper function to `src/lib/audio.ts`
- [x] Add unit tests for `computeLevel()` in `src/lib/__tests__/audio.test.ts` (returns both normalized and db values)
- [x] Add unit tests for `dbToNormalized()` in `src/lib/__tests__/audio.test.ts` (clamping at floor/ceiling, mid-range values)
- [x] Verify existing `computeNormalizedLevel` tests still pass

### Phase 2: Add `currentDb` to hook types and `useVoiceMirror`

- [x] Add `currentDb: number | null` field to `VoiceMirrorState` in `src/hooks/types.ts`
- [x] Add `currentDb` state (`useState<number | null>(null)`) in `src/hooks/useVoiceMirror.ts`
- [x] Replace the dual RMS computation in `onAudioReady` (lines 202-209) with a single `computeLevel()` call
- [x] Call `setCurrentDb(db)` alongside `setLevelHistory` in the `onAudioReady` callback
- [x] Call `setCurrentDb(null)` in `pauseMonitoring()` to clear dB when pausing
- [x] Call `setCurrentDb(null)` at the start of `stopAndPlay()` to clear dB when transitioning to playback
- [x] Return `currentDb` from the `useVoiceMirror` hook's return object
- [x] Update import in `useVoiceMirror.ts` to import `computeLevel` instead of (or in addition to) `computeNormalizedLevel`
- [x] Add test in `src/hooks/__tests__/useVoiceMirror.test.ts`: `currentDb` updates on audio chunk during idle phase
- [x] Add test in `src/hooks/__tests__/useVoiceMirror.test.ts`: `currentDb` updates on audio chunk during recording phase
- [x] Add test in `src/hooks/__tests__/useVoiceMirror.test.ts`: `currentDb` resets to null when pausing
- [x] Add test in `src/hooks/__tests__/useVoiceMirror.test.ts`: `currentDb` resets to null when transitioning to playback

### Phase 3: Update `AudioLevelMeter` component

- [x] Add `currentDb`, `voiceThresholdDb`, and `silenceThresholdDb` to the `Props` type in `src/components/AudioLevelMeter.tsx`
- [x] Import `Text` from `react-native` and `dbToNormalized` from `../lib/audio`
- [x] Add `VOICE_THRESHOLD_COLOR` and `SILENCE_THRESHOLD_COLOR` constants
- [x] Add `showGuides` boolean derived from phase (`idle` or `recording`)
- [x] Compute `voiceNormalized` and `silenceNormalized` using `dbToNormalized()`
- [x] Compute guide line `top` positions using the formula `(MAX_HEIGHT - barHeight) / 2`
- [x] Render voice threshold dashed guide line (conditionally when `showGuides` is true)
- [x] Render silence threshold dashed guide line (conditionally when `showGuides` is true)
- [x] Render current dB text label (conditionally when `showGuides` is true and `currentDb` is not null)
- [x] Format dB label as `Math.round(currentDb)` with " dB" suffix
- [x] Add `guideLine` style (absolute positioned, dashed border, `zIndex: 1`)
- [x] Add `dbLabelContainer` style (absolute positioned, top-right of meter)
- [x] Add `dbLabel` style (font size 12, `tabular-nums` font variant)
- [x] Add test in `src/components/__tests__/AudioLevelMeter.test.tsx`: guide lines render during `idle` phase
- [x] Add test in `src/components/__tests__/AudioLevelMeter.test.tsx`: guide lines render during `recording` phase
- [x] Add test in `src/components/__tests__/AudioLevelMeter.test.tsx`: guide lines hidden during `playing` phase
- [x] Add test in `src/components/__tests__/AudioLevelMeter.test.tsx`: guide lines hidden during `paused` phase
- [x] Add test in `src/components/__tests__/AudioLevelMeter.test.tsx`: dB label shows when `currentDb` is provided and phase is `idle`
- [x] Add test in `src/components/__tests__/AudioLevelMeter.test.tsx`: dB label hidden when `currentDb` is null

### Phase 4: Wire through `VoiceMirrorScreen`

- [x] Destructure `currentDb` from `useVoiceMirror()` return value in `src/screens/VoiceMirrorScreen.tsx`
- [x] Pass `currentDb` prop to `AudioLevelMeter` (use `isListPlaying ? null : currentDb`)
- [x] Pass `voiceThresholdDb={settings.voiceThresholdDb}` to `AudioLevelMeter`
- [x] Pass `silenceThresholdDb={settings.silenceThresholdDb}` to `AudioLevelMeter`

### Phase 5: Verification

- [x] Run `pnpm typecheck` and confirm no type errors
- [x] Run `pnpm lint` and confirm no lint errors
- [x] Run `pnpm test:ci` and confirm all tests pass (existing + new)
