# SVG Level Meter -- Implementation Plan

## Goal

Replace the current `AudioLevelMeter` implementation, which renders 40+ `View` elements with inline styles that change every ~93ms, with an SVG-based implementation using `react-native-svg`. The primary objectives are:

1. **Reduce rendering overhead** -- the current approach creates 40 `View` elements, each with a unique `style` object on every render (dynamic `height`, `opacity`, `backgroundColor`). React must diff all these style objects on every 93ms tick. SVG `Rect` elements with primitive numeric props are cheaper for React to diff, and the native SVG renderer can batch updates more efficiently.

2. **Fix cross-platform dashed-line inconsistencies** -- the current guide lines use `borderStyle: 'dashed'` on `View`, which renders differently across Android versions. SVG `Line` with `strokeDasharray` provides consistent cross-platform dashed line rendering.

3. **Simplify coordinate-based layout** -- the current approach mixes flexbox (`alignItems: 'center'`, `gap`, `paddingHorizontal`) with absolute positioning for guide lines and the dB label. An SVG `viewBox` provides a single coordinate space where all elements (bars, guides, label) are positioned explicitly, eliminating the need to manually synchronize `left: 16` / `right: 16` with `paddingHorizontal: 16`.

## Architecture / Approach

### Dependency: install `react-native-svg`

`react-native-svg` is not currently in `package.json`. For Expo projects, installation via `npx expo install react-native-svg` ensures version compatibility. The jest config in `package.json` needs its `transformIgnorePatterns` updated to include `react-native-svg` so it is transpiled by jest-expo during tests.

### SVG coordinate system

Define a `viewBox` that maps directly to the current visual layout:

```
viewBox = "0 0 TOTAL_WIDTH TOTAL_HEIGHT"
```

Where:
- `TOTAL_HEIGHT = MAX_HEIGHT = 100` (matches the current container height)
- `TOTAL_WIDTH = LEVEL_HISTORY_SIZE * BAR_WIDTH + (LEVEL_HISTORY_SIZE - 1) * BAR_GAP`
  = `40 * 4 + 39 * 3 = 160 + 117 = 277`

The outer `<Svg>` component is wrapped in a `View` that provides horizontal padding (currently 16px each side) and the dB label is rendered as a React Native `Text` outside the SVG (since SVG Text has different baseline behavior and font rendering). This keeps the SVG coordinate system clean and focused on the bar+guide visualization.

### Component structure

```tsx
// src/components/AudioLevelMeter.tsx

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { Phase } from '../hooks/types';
import { dbToNormalized } from '../lib/audio';
import { LEVEL_HISTORY_SIZE } from '../constants/audio';

const BAR_WIDTH = 4;
const BAR_GAP = 3;
const MAX_HEIGHT = 100;
const MIN_HEIGHT = 4;
const CONTENT_WIDTH =
  LEVEL_HISTORY_SIZE * BAR_WIDTH + (LEVEL_HISTORY_SIZE - 1) * BAR_GAP; // 277

// ... PHASE_COLOR, PHASE_GLOW, threshold color constants unchanged ...

export function AudioLevelMeter({
  history,
  phase,
  currentDb,
  voiceThresholdDb,
  silenceThresholdDb,
}: Props) {
  const color = PHASE_COLOR[phase];
  const glowColor = PHASE_GLOW[phase];
  const isPaused = phase === 'paused';
  const showGuides = phase === 'idle' || phase === 'recording';

  const voiceNormalized = dbToNormalized(voiceThresholdDb);
  const silenceNormalized = dbToNormalized(silenceThresholdDb);

  const voiceHeight = Math.max(MIN_HEIGHT, voiceNormalized * MAX_HEIGHT);
  const silenceHeight = Math.max(MIN_HEIGHT, silenceNormalized * MAX_HEIGHT);

  // Guide line Y positions (from top of viewBox)
  const voiceY = (MAX_HEIGHT - voiceHeight) / 2;
  const silenceY = (MAX_HEIGHT - silenceHeight) / 2;

  return (
    <View style={styles.container}>
      <Svg
        width="100%"
        height={MAX_HEIGHT}
        viewBox={`0 0 ${CONTENT_WIDTH} ${MAX_HEIGHT}`}
      >
        {/* Glow background */}
        <Rect
          x={0}
          y={MAX_HEIGHT * 0.2}
          width={CONTENT_WIDTH}
          height={MAX_HEIGHT * 0.6}
          rx={40}
          fill={glowColor}
        />

        {/* Guide lines */}
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

        {/* Bars */}
        {history.map((value, i) => {
          const normalizedValue = isPaused ? 0.1 : value;
          const height = Math.max(MIN_HEIGHT, normalizedValue * MAX_HEIGHT);
          const opacity = isPaused ? 0.4 : 0.5 + value * 0.5;
          const x = i * (BAR_WIDTH + BAR_GAP);
          const y = (MAX_HEIGHT - height) / 2;

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

      {/* dB label rendered outside SVG for consistent text rendering */}
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
```

### Key differences from the current implementation

1. **Bars**: `View` with `{ height, backgroundColor, opacity }` style objects become `Rect` elements with `x`, `y`, `width`, `height`, `rx`, `fill`, `opacity` props. These are primitive numeric/string props -- cheaper for React to diff than nested style objects.

2. **Bar positioning**: Currently relies on flexbox `gap: 3` and `alignItems: 'center'` to space and center bars. In SVG, each bar's `x` is explicitly computed as `i * (BAR_WIDTH + BAR_GAP)`, and `y` is `(MAX_HEIGHT - height) / 2` for vertical centering. This eliminates the flexbox layout pass entirely.

3. **Glow background**: The absolutely-positioned `View` with `top: '20%'` / `bottom: '20%'` becomes a `Rect` with `y={MAX_HEIGHT * 0.2}` and `height={MAX_HEIGHT * 0.6}`.

4. **Guide lines**: `View` with `borderStyle: 'dashed'` / `borderTopWidth: 1` becomes `Line` with `strokeDasharray="4,4"`. This produces consistent dashed rendering across iOS and Android.

5. **dB label**: Remains as a React Native `Text` outside the SVG. SVG `<Text>` has different font rendering characteristics and baseline behavior. Keeping the dB label as a RN `Text` preserves the current appearance (font weight, `tabular-nums` variant, positioning above the meter).

6. **Container**: The outer `View` retains `paddingHorizontal: 16` for spacing within the parent card. The SVG fills the width within this padding. The `position: 'relative'` is kept for the absolutely-positioned dB label.

### Updated styles

```typescript
const styles = StyleSheet.create({
  container: {
    height: MAX_HEIGHT,
    paddingHorizontal: 16,
    position: 'relative',
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

The styles are significantly simpler. The following styles from the current implementation are no longer needed because their layout concerns are handled by SVG coordinates:

- `container.flexDirection`, `container.alignItems`, `container.justifyContent`, `container.gap` -- bar positioning is done via SVG `x`/`y` coordinates
- `glowBackground` -- replaced by an SVG `Rect`
- `bar` -- replaced by SVG `Rect` elements
- `guideLine` -- replaced by SVG `Line` elements

### Updating the test file

The existing tests in `src/components/__tests__/AudioLevelMeter.test.tsx` use two approaches that need updating:

1. **Bar count test**: Currently finds bars with `UNSAFE_getAllByType(View).filter(...)` looking for `"width":4` in JSON. With SVG, bars are `Rect` elements. The test should import `Rect` from `react-native-svg` and use `UNSAFE_getAllByType(Rect)` to find bars. Since the glow `Rect` also exists, filter by `width={BAR_WIDTH}`:

```tsx
import { Rect, Line } from 'react-native-svg';

it(`renders ${LEVEL_HISTORY_SIZE} bars`, () => {
  const { UNSAFE_getAllByType } = render(
    <AudioLevelMeter {...defaultProps} />,
  );
  const bars = UNSAFE_getAllByType(Rect).filter(
    (el) => el.props.width === BAR_WIDTH,
  );
  expect(bars).toHaveLength(LEVEL_HISTORY_SIZE);
});
```

2. **Guide line tests**: Currently check for `'dashed'` in `toJSON()`. With SVG, guide lines are `Line` elements with `strokeDasharray`. The test should check for `Line` elements or look for `strokeDasharray` in the JSON:

```tsx
it('renders guide lines during idle phase', () => {
  const { UNSAFE_getAllByType } = render(
    <AudioLevelMeter {...defaultProps} phase="idle" />,
  );
  const lines = UNSAFE_getAllByType(Line);
  expect(lines.length).toBe(2);
});

it('hides guide lines during playing phase', () => {
  const { UNSAFE_getAllByType } = render(
    <AudioLevelMeter {...defaultProps} phase="playing" />,
  );
  const lines = UNSAFE_getAllByType(Line);
  expect(lines.length).toBe(0);
});
```

3. **dB label tests**: These use `getByText` and `queryByText`, which work the same way since the label remains a React Native `Text` component. No changes needed.

### Jest configuration for `react-native-svg`

The `transformIgnorePatterns` in `package.json` must include `react-native-svg` so Jest transpiles it:

```json
"transformIgnorePatterns": [
  "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|react-native-audio-api|react-native-svg))"
]
```

Additionally, `react-native-svg` may need a manual mock for the test environment if its native module initialization fails in jest-expo. If needed, create `__mocks__/react-native-svg.tsx` at the project root that re-exports mock components. However, `jest-expo` typically handles Expo-compatible libraries without extra mocking, so we should try running tests first before adding mocks.

## File Paths That Need Modification

| File | Change |
|------|--------|
| `package.json` | Add `react-native-svg` dependency (via `npx expo install`); update `transformIgnorePatterns` to include `react-native-svg` |
| `src/components/AudioLevelMeter.tsx` | Rewrite to use `Svg`, `Rect`, `Line` from `react-native-svg` instead of `View` elements for bars, glow, and guide lines |
| `src/components/__tests__/AudioLevelMeter.test.tsx` | Update bar-finding logic to use `Rect` instead of `View`; update guide line assertions to use `Line` instead of checking for `'dashed'` |

## Considerations and Trade-offs

### Why SVG over the current View-based approach?

The current implementation creates 40 `View` elements, each with a unique inline style object containing `height`, `opacity`, and `backgroundColor`. Every 93ms, all 40 style objects change. React diffs each one, then the native bridge sends 40 style updates that trigger layout recalculation for each View (flexbox must recompute positions due to `alignItems: 'center'`).

With SVG, bars are `Rect` elements whose props (`x`, `y`, `height`, `opacity`) are primitive values. React's diff of primitive prop values is faster than diffing style objects. More importantly, the SVG renderer handles positioning natively within the viewBox coordinate system without flexbox -- there is no layout pass for repositioning 40 sibling elements.

### Why not use React Native Animated or Reanimated?

Animated/Reanimated would let bar heights run on the UI thread, bypassing the JS bridge. However:
- The level history updates at ~10.7 Hz (every 93ms), which is slow enough that JS-thread re-renders are not a bottleneck.
- The data source is an array of 40 values computed on the JS thread. Using Animated would require 40 `Animated.Value` objects or a shared value, adding complexity.
- SVG gives us the rendering efficiency we need without the complexity of an animation framework.

If future profiling shows the JS thread is still the bottleneck, Reanimated 3's `useSharedValue` could be explored as a second optimization, but SVG migration is the simpler first step.

### Why keep the dB label as React Native Text?

SVG `<Text>` in `react-native-svg` has different rendering characteristics:
- Font weight rendering varies more across platforms than RN `Text`.
- The `fontVariant: ['tabular-nums']` feature may not be supported.
- Positioning uses SVG coordinates rather than absolute positioning relative to the parent View.

Since the dB label is a static text element that does not participate in the high-frequency bar updates, keeping it as RN `Text` preserves visual consistency with no performance cost.

### Performance impact of react-native-svg

For 40 `Rect` elements updating at ~10.7 Hz, `react-native-svg` performance is well within acceptable bounds. The library renders via native SVG views (Core Graphics on iOS, Android Canvas on Android), which are optimized for vector drawing. The element count (40 rects + 1 glow rect + 2 lines) is modest.

One concern from the research is that SVG re-renders may be heavier than plain `View` re-renders. However, the key advantage is that SVG elements with primitive props avoid the style-object diffing and flexbox layout recalculation overhead. The net result should be positive.

### Bundle size impact

`react-native-svg` is a mature library (~700KB uncompressed) that adds a native module. It is part of the Expo default compatible library set and is well-maintained. Adding it introduces a maintenance obligation (version compatibility with Expo SDK upgrades), but Expo's `npx expo install` handles version pinning automatically.

### Test environment behavior

`react-native-svg` components render differently in the jest-expo test environment than standard RN components. `UNSAFE_getAllByType(Rect)` works because the library exports actual React component classes. The `toJSON()` output will show SVG elements differently than `View` elements, but the tests we need (bar count, guide line presence/absence, dB label text) can all be expressed in terms of component types and props.

If the default jest-expo setup cannot resolve `react-native-svg` native modules, a manual mock at `__mocks__/react-native-svg.tsx` can provide lightweight React components that pass through props. This is a well-documented pattern for `react-native-svg` testing.

### Migration safety

The component's public API (`Props` type) does not change at all. The `AudioLevelMeter` component accepts the same props and renders the same visual output. The only external change is the internal rendering technology. This means:
- `VoiceMirrorScreen.tsx` requires zero changes.
- `src/hooks/` files require zero changes.
- Only the component file and its test file need modification.

### Potential future improvements enabled by SVG

Once the meter is SVG-based, several enhancements become straightforward:
- **Gradient bar fills**: Use `<Defs>` + `<LinearGradient>` for bars that transition from one color at the base to another at the peak.
- **Smooth height transitions**: SVG props can be animated with `react-native-reanimated` for smoother bar height changes.
- **Clip paths**: Use `<ClipPath>` for visual effects like rounded meter edges.
- **Touch interaction**: SVG elements support press events natively, enabling future features like tapping a bar to see its exact dB value.

These are not part of this plan but illustrate the long-term value of the SVG migration.

## Todo

### Phase 1: Install dependency and configure tooling

- [x] Run `npx expo install react-native-svg` to add `react-native-svg` to `package.json` with Expo-compatible version
- [x] Update `transformIgnorePatterns` in `package.json` Jest config to include `react-native-svg` in the exclusion list
- [x] Verify the dependency installs correctly by running `pnpm install` (if not already done by expo install)

### Phase 2: Rewrite AudioLevelMeter component

- [x] Add imports for `Svg`, `Rect`, `Line` from `react-native-svg` in `src/components/AudioLevelMeter.tsx`
- [x] Add `CONTENT_WIDTH` constant computed from `LEVEL_HISTORY_SIZE`, `BAR_WIDTH`, and `BAR_GAP`
- [x] Import `LEVEL_HISTORY_SIZE` from `../constants/audio`
- [x] Replace the glow background `View` with an SVG `Rect` element (`y={MAX_HEIGHT * 0.2}`, `height={MAX_HEIGHT * 0.6}`, `rx={40}`)
- [x] Replace the guide line `View` elements (using `borderStyle: 'dashed'`) with SVG `Line` elements using `strokeDasharray="4,4"`
- [x] Replace the bar `View` elements with SVG `Rect` elements, computing `x` as `i * (BAR_WIDTH + BAR_GAP)` and `y` as `(MAX_HEIGHT - height) / 2`
- [x] Wrap the glow, guide lines, and bars inside an `<Svg>` element with `width="100%"`, `height={MAX_HEIGHT}`, and `viewBox={...}`
- [x] Keep the dB label as a React Native `Text` component outside the `<Svg>` element
- [x] Update `styles` to remove `flexDirection`, `alignItems`, `justifyContent`, `gap` from `container`
- [x] Remove the `glowBackground` style definition (no longer needed)
- [x] Remove the `bar` style definition (no longer needed)
- [x] Remove the `guideLine` style definition (no longer needed)
- [x] Keep `container`, `dbLabelContainer`, and `dbLabel` styles with simplified values
- [x] Remove the `View` import if no longer used (it is still needed for the outer container and dB label container)

### Phase 3: Update tests

- [x] In `src/components/__tests__/AudioLevelMeter.test.tsx`, add import for `Rect` and `Line` from `react-native-svg`
- [x] Remove the `View` import (no longer needed for bar detection)
- [x] Update the bar count test: replace `UNSAFE_getAllByType(View).filter(...)` with `UNSAFE_getAllByType(Rect).filter((el) => el.props.width === BAR_WIDTH)` (import `BAR_WIDTH` or use literal `4`)
- [x] Update the "renders guide lines during idle phase" test: use `UNSAFE_getAllByType(Line)` and assert length is 2
- [x] Update the "renders guide lines during recording phase" test: use `UNSAFE_getAllByType(Line)` and assert length is 2
- [x] Update the "hides guide lines during playing phase" test: use `UNSAFE_getAllByType(Line)` and assert length is 0
- [x] Update the "hides guide lines during paused phase" test: use `UNSAFE_getAllByType(Line)` and assert length is 0
- [x] Verify the dB label tests (`getByText`, `queryByText`) still pass without changes

### Phase 4: Verify and handle test environment issues

- [x] Run `pnpm test:ci` to verify all tests pass with `react-native-svg` in the Jest environment
- [x] If `react-native-svg` native module initialization fails in Jest, create `__mocks__/react-native-svg.tsx` with mock components that pass through props
- [x] Run `pnpm typecheck` to verify no TypeScript errors
- [x] Run `pnpm lint` to verify no linting issues

### Phase 5: Manual verification

- [ ] Run the app on iOS and verify the level meter renders correctly in all phases (idle, recording, playing, paused)
- [ ] Verify guide lines render as dashed lines with correct colors during idle and recording phases
- [ ] Verify guide lines are hidden during playing and paused phases
- [ ] Verify the dB label displays correctly above the meter
- [ ] Verify the glow background renders behind the bars
- [ ] Run the app on Android and verify consistent rendering (especially dashed guide lines)
