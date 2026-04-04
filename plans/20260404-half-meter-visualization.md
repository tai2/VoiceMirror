# Half-Meter Visualization -- Implementation Plan

## Goal

The current `AudioLevelMeter` component renders bars that grow symmetrically from the vertical center -- they extend both upward and downward. This symmetric shape wastes half the vertical space with a mirror image of the other half, providing no additional information. The goal is to change the visualization so bars grow upward only from a fixed baseline at the bottom of the meter area, and double the meter's display height from 100 to 200 logical units. This makes bars twice as tall and the visualization more readable, while using the same amount of screen real estate (or even less, since the mirrored half contributed no information).

Concretely:

1. **Bars grow upward from the bottom** instead of expanding symmetrically from the center.
2. **The SVG viewBox height doubles** from 100 to 200, so each bar can reach up to 200 units tall, giving finer visual granularity for level differences.
3. **Guide lines, glow background, and dB label** are repositioned to match the new bottom-anchored layout.
4. **Existing tests** are updated to reflect the new coordinate system.

## Architecture / Approach

### Current symmetric layout

In the current implementation (`src/components/AudioLevelMeter.tsx`), each bar is vertically centered within the SVG viewBox:

```typescript
const y = (MAX_HEIGHT - height) / 2;
```

This places the bar so it extends equally above and below the midpoint. For a bar with `height = 60` in a `MAX_HEIGHT = 100` viewBox, the bar runs from `y=20` to `y=80` -- 30 units above center and 30 below. The bottom half is a visual mirror of the top half.

### New bottom-anchored layout

In the new layout, bars are anchored at the bottom of the SVG viewBox. The `y` coordinate of each bar becomes:

```typescript
const y = MAX_HEIGHT - height;
```

For a bar with `height = 120` in a `MAX_HEIGHT = 200` viewBox, the bar runs from `y=80` to `y=200` -- growing upward from the bottom edge.

### Doubling the height

The `MAX_HEIGHT` constant changes from `100` to `200`. Since bar heights are computed as `normalizedValue * MAX_HEIGHT`, a full-scale value (1.0) now produces a 200-unit tall bar instead of 100-unit. The `MIN_HEIGHT` constant also doubles from `4` to `8` to maintain proportional appearance.

The SVG element's rendered pixel height also changes from `100` to `200`, and the container style's `height` matches. This means the meter will occupy 200px of vertical screen space instead of 100px. However, since the old symmetric layout used 100px to show bars that were effectively at most 50px in useful visual extent (the top half), the new layout gives 200px of useful visual extent -- a 4x improvement in information density per pixel of screen space used, while only doubling the actual screen space consumed.

### Changes to `AudioLevelMeter.tsx`

The following constants and computations change:

```typescript
// Before:
const MAX_HEIGHT = 100;
const MIN_HEIGHT = 4;

// After:
const MAX_HEIGHT = 200;
const MIN_HEIGHT = 8;
```

Bar `y` computation changes from center-anchored to bottom-anchored:

```typescript
// Before (symmetric, centered):
const y = (MAX_HEIGHT - height) / 2;

// After (bottom-anchored, growing upward):
const y = MAX_HEIGHT - height;
```

This applies to both the bar rendering in the `history.map()` loop and to the guide line positioning.

### Guide line repositioning

Guide lines currently use the same centered formula as bars:

```typescript
const voiceY = (MAX_HEIGHT - voiceHeight) / 2;
const silenceY = (MAX_HEIGHT - silenceHeight) / 2;
```

In the new layout, guide lines are positioned from the bottom, consistent with the bars:

```typescript
const voiceY = MAX_HEIGHT - voiceHeight;
const silenceY = MAX_HEIGHT - silenceHeight;
```

This places each guide line at the top edge of where a bar at that threshold level would reach, which is the same semantic meaning as before -- "bars reaching above this line are above the threshold."

### Glow background repositioning

The glow `Rect` currently occupies the middle 60% of the viewBox:

```typescript
<Rect
  x={0}
  y={MAX_HEIGHT * 0.2}
  width={CONTENT_WIDTH}
  height={MAX_HEIGHT * 0.6}
  rx={40}
  fill={glowColor}
/>
```

In the new bottom-anchored layout, the glow should cover the lower portion of the meter where bars appear. Using the bottom 60%:

```typescript
<Rect
  x={0}
  y={MAX_HEIGHT * 0.4}
  width={CONTENT_WIDTH}
  height={MAX_HEIGHT * 0.6}
  rx={40}
  fill={glowColor}
/>
```

This places the glow from `y=80` to `y=200` (the bottom 60%), wrapping around where most bar activity occurs.

### Complete updated component

```tsx
// src/components/AudioLevelMeter.tsx

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import type { Phase } from '../hooks/types';
import { dbToNormalized } from '../lib/audio';
import { LEVEL_HISTORY_SIZE } from '../constants/audio';

export const BAR_WIDTH = 4;
const BAR_GAP = 3;
const MAX_HEIGHT = 200;
const MIN_HEIGHT = 8;
const CONTENT_WIDTH =
  LEVEL_HISTORY_SIZE * BAR_WIDTH + (LEVEL_HISTORY_SIZE - 1) * BAR_GAP;

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

const VOICE_THRESHOLD_COLOR = 'rgba(239, 68, 68, 0.6)';
const SILENCE_THRESHOLD_COLOR = 'rgba(251, 191, 36, 0.6)';

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

  const voiceHeight = Math.max(MIN_HEIGHT, voiceNormalized * MAX_HEIGHT);
  const silenceHeight = Math.max(MIN_HEIGHT, silenceNormalized * MAX_HEIGHT);

  // Guide lines positioned from bottom (top edge of bar at threshold level)
  const voiceY = MAX_HEIGHT - voiceHeight;
  const silenceY = MAX_HEIGHT - silenceHeight;

  return (
    <View style={styles.container}>
      <Svg
        width="100%"
        height={MAX_HEIGHT}
        viewBox={`0 0 ${CONTENT_WIDTH} ${MAX_HEIGHT}`}
      >
        <Rect
          x={0}
          y={MAX_HEIGHT * 0.4}
          width={CONTENT_WIDTH}
          height={MAX_HEIGHT * 0.6}
          rx={40}
          fill={glowColor}
        />

        {showGuides && (
          <>
            <Line
              x1={0}
              y1={voiceY}
              x2={CONTENT_WIDTH}
              y2={voiceY}
              stroke={VOICE_THRESHOLD_COLOR}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <Line
              x1={0}
              y1={silenceY}
              x2={CONTENT_WIDTH}
              y2={silenceY}
              stroke={SILENCE_THRESHOLD_COLOR}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
          </>
        )}

        {history.map((value, i) => {
          const normalizedValue = isPaused ? 0.1 : value;
          const height = Math.max(MIN_HEIGHT, normalizedValue * MAX_HEIGHT);
          const opacity = isPaused ? 0.4 : 0.5 + value * 0.5;
          const x = i * (BAR_WIDTH + BAR_GAP);
          const y = MAX_HEIGHT - height;

          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={height}
              rx={3}
              fill={color}
              opacity={opacity}
            />
          );
        })}
      </Svg>

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
    height: MAX_HEIGHT,
    paddingHorizontal: 16,
    position: 'relative',
    alignSelf: 'stretch',
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

### Changes to test file

The test file at `src/components/__tests__/AudioLevelMeter.test.tsx` needs no structural changes since the tests check for:

1. Number of `Rect` bars (filtered by `BAR_WIDTH` which stays at 4) -- unchanged.
2. Presence/absence of `Line` elements for guide lines -- unchanged.
3. dB label text -- unchanged.

However, the tests should remain correct because `BAR_WIDTH` is still exported as `4`. The only thing to verify is that the `BAR_WIDTH` import and filter still works, since the bar `Rect` elements still have `width={BAR_WIDTH}`.

No test changes are required for the existing tests. The behavior and component API remain identical.

## File Paths That Need Modification

| File | Change |
|------|--------|
| `src/components/AudioLevelMeter.tsx` | Change `MAX_HEIGHT` from 100 to 200; change `MIN_HEIGHT` from 4 to 8; change bar `y` from `(MAX_HEIGHT - height) / 2` to `MAX_HEIGHT - height`; change guide line `y` from `(MAX_HEIGHT - h) / 2` to `MAX_HEIGHT - h`; change glow `y` from `MAX_HEIGHT * 0.2` to `MAX_HEIGHT * 0.4`; update container style height to `MAX_HEIGHT` |

No other files need modification. The component's `Props` type is unchanged, `VoiceMirrorScreen.tsx` passes the same props, and the test file's assertions remain valid because `BAR_WIDTH` is unchanged and the structural checks (bar count, line presence, dB label) are not sensitive to coordinate values.

## Considerations and Trade-offs

### Screen space usage

Doubling `MAX_HEIGHT` from 100 to 200 means the meter takes 200px of vertical screen space instead of 100px. On a typical phone screen (812pt on iPhone 13), this is about 25% of the screen height -- a significant increase. However, the old symmetric layout only had ~50px of useful visual extent (the top half of each bar; the bottom half was a mirror). The new layout has 200px of useful visual extent, a net improvement of 4x information density per pixel of screen used, at the cost of 2x screen real estate.

If 200px is too tall in practice, `MAX_HEIGHT` can be tuned to a smaller value (e.g., 150 or 160) while still providing better space efficiency than the symmetric 100px layout. The value 200 was chosen to exactly double the effective visual resolution of the bars.

### Visual continuity

The change from center-anchored to bottom-anchored bars is a noticeable visual difference. Users accustomed to the "audio waveform" look of symmetric bars will see a different aesthetic -- more like a bar chart or equalizer. This is a deliberate trade-off: the equalizer style is more space-efficient and arguably more intuitive for showing "level" (taller = louder) compared to the symmetric "waveform" style.

### No changes to data layer

The normalized values (0 to 1) and the `LEVEL_HISTORY_SIZE` (40 bars) remain the same. The only change is how those values are mapped to visual coordinates. This means the hooks, services, and state management are entirely unaffected.

### Guide line semantics

In the symmetric layout, each guide line was drawn at `y = (MAX_HEIGHT - thresholdHeight) / 2`, representing the top edge of a centered bar. In the new layout, the guide line is at `y = MAX_HEIGHT - thresholdHeight`, still representing the top edge of a bar at that threshold level. The visual meaning is identical: "bars that reach above this line exceed the threshold."

### Glow background placement

The glow rectangle shifts from the vertical center (20%-80% of the viewBox) to the bottom (40%-100%). This keeps the glow concentrated where bar activity occurs. The glow's visual role is ambient backlighting, so its exact placement is not critical, but anchoring it at the bottom avoids having a glow region above the tallest possible bars.

### rx (corner radius) on bars

The bar corner radius `rx={3}` is unchanged. With taller bars (up to 200 units vs. 100), the 3-unit radius remains proportionally subtle. No adjustment is needed.

### Paused state

In paused state, bars are forced to `normalizedValue = 0.1`, producing bars of height `max(8, 0.1 * 200) = 20` units. These will be small bars anchored at the bottom of the meter, which is visually appropriate for a dormant state.

### dB label position

The dB label is positioned at `top: -20` relative to the container via absolute positioning. Since the container height increases from 100 to 200, the label remains above the meter. The parent `meterContainer` in `VoiceMirrorScreen.tsx` has `paddingVertical: 8`, which provides space for the label. The label position does not need adjustment.

## Todo

### Phase 1: Update constants in `AudioLevelMeter.tsx`

- [x] Change `MAX_HEIGHT` from `100` to `200`
- [x] Change `MIN_HEIGHT` from `4` to `8`

### Phase 2: Change bar positioning from center-anchored to bottom-anchored

- [x] Update bar `y` computation from `(MAX_HEIGHT - height) / 2` to `MAX_HEIGHT - height` in the `history.map()` loop

### Phase 3: Reposition guide lines

- [x] Update `voiceY` from `(MAX_HEIGHT - voiceHeight) / 2` to `MAX_HEIGHT - voiceHeight`
- [x] Update `silenceY` from `(MAX_HEIGHT - silenceHeight) / 2` to `MAX_HEIGHT - silenceHeight`

### Phase 4: Reposition glow background

- [x] Change glow `Rect` `y` from `MAX_HEIGHT * 0.2` to `MAX_HEIGHT * 0.4`

### Phase 5: Update container style

- [x] Verify container style `height` references `MAX_HEIGHT` (should auto-update with constant change)
- [x] Verify SVG `height` attribute references `MAX_HEIGHT` (should auto-update with constant change)

### Phase 6: Verify tests

- [x] Run `pnpm test:ci` and confirm existing `AudioLevelMeter.test.tsx` tests pass without changes
- [x] Verify bar count assertions still work (filtered by `BAR_WIDTH` which is unchanged)
- [x] Verify guide line presence/absence assertions still pass
- [x] Verify dB label assertions still pass

### Phase 7: Verification

- [x] Run `pnpm typecheck` to confirm no type errors
- [x] Run `pnpm lint` to confirm no lint errors
- [x] Run `pnpm test:ci` to confirm all tests pass
- [ ] Visually verify on device/simulator that bars grow upward from bottom
- [ ] Visually verify guide lines appear at correct threshold positions
- [ ] Visually verify glow background covers lower portion of meter
- [ ] Visually verify dB label is still visible above the meter
