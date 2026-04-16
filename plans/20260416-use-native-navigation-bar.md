# Migrate Index Screen to Native Navigation Bar

## Goal

Replace the custom hand-built top bar on the index screen (`VoiceMirrorScreen`) with the native Stack header provided by expo-router. The index screen currently sets `headerShown: false` and renders its own `<View style={styles.topBar}>` containing the "VoiceMirror" title and a settings gear icon. The settings screen already uses the native header correctly.

After this migration, both screens will use the native Stack header, giving the app a consistent, platform-native appearance while reducing custom UI code. The settings gear icon must be preserved as a `headerRight` element in the native header.

## Architecture / Approach

The migration involves three coordinated changes across two files:

1. **Enable the native header on the index screen** by removing `headerShown: false` and configuring `headerRight` to render the settings gear icon.
2. **Remove the custom top bar JSX and styles** from `VoiceMirrorScreen`.
3. **Replace `SafeAreaView` with `View`** in `VoiceMirrorScreen`, since the native Stack header handles the top safe area inset. The bottom safe area is handled by the Stack's content area.

### Why this is straightforward

- The Stack navigator in `app/_layout.tsx` already has global `screenOptions` that style the header with the correct dark background (`#0A0A0B`), white tint color (`#FAFAFA`), and bold title font weight. The index screen simply needs to stop opting out.
- The `headerRight` option accepts a render function, which is the standard way to add buttons to a native Stack header in React Navigation / expo-router.
- The settings screen already demonstrates the native header working correctly, so no new patterns are introduced.

### SafeAreaView removal rationale

When `headerShown` is `true` (the default), React Navigation's native stack handles the top safe area inset automatically -- the header itself occupies the space behind the status bar / notch. Wrapping content in `SafeAreaView` with the native header visible can cause double top padding on some devices.

The `contentStyle` in `screenOptions` already sets `backgroundColor: colors.background`, so the content area below the header is correctly colored without needing a separate root view background.

For the bottom safe area: the native stack's content area does not automatically apply bottom insets. However, the current `VoiceMirrorScreen` layout uses `flex: 1` on the `recordingsSection` which contains a `FlatList` (via `RecordingsList`). The `FlatList` handles its own content insets. For the permission-denied and loading states (which are centered), bottom inset is not critical. Therefore, replacing `SafeAreaView` with a plain `View` is safe.

## Code Changes

### File 1: `app/_layout.tsx`

Add the `router` import and `AntDesign` icon import, then configure `headerRight` on the index screen.

**Add imports** at the top of the file (alongside existing imports):

```tsx
import { useRouter } from "expo-router";
import { AntDesign } from "@expo/vector-icons";
import { Pressable, View as RNView } from "react-native";
```

Note: `View` is already imported from `react-native` on line 2, and `Pressable` is not currently imported in `_layout.tsx`, so it needs to be added to the existing destructured import.

**Update the `RootStack` function** to add the settings button:

```tsx
function RootStack() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: {
          fontWeight: "600",
        },
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "VoiceMirror",
          headerShadowVisible: false,
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/settings")}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <AntDesign
                name="setting"
                size={22}
                color={colors.textSecondary}
              />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          title: t("settings.title"),
          presentation: "card",
          headerShadowVisible: false,
        }}
      />
    </Stack>
  );
}
```

Key differences from the current code:

- Removed `headerShown: false` -- the native header is now visible
- Added `headerShadowVisible: false` to match the settings screen's style (no separator line)
- Added `headerRight` with the settings gear icon using `AntDesign`
- The icon is rendered as a simple `Pressable` + `AntDesign` without the bordered container (`settingsIconContainer`), since the native header provides its own spacing and alignment -- a bordered container looks out of place in a native header

### File 2: `src/screens/VoiceMirrorScreen.tsx`

**Remove imports that are no longer needed:**

Remove from the import list:

- `useRouter` from `expo-router` (navigation to settings is now handled in `_layout.tsx`)
- `AntDesign` from `@expo/vector-icons`
- `Pressable` from `react-native` (only used for the settings button; the pause button also uses it, so check -- it IS still used for the pause button, so `Pressable` stays)
- `SafeAreaView` from `react-native-safe-area-context`

Updated imports:

```tsx
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useVoiceMirror } from "../hooks/useVoiceMirror";
import { useRecordings } from "../hooks/useRecordings";
import { AudioLevelMeter } from "../components/AudioLevelMeter";
import { PhaseDisplay } from "../components/PhaseDisplay";
import { RecordingsList } from "../components/RecordingsList";
import {
  AudioContextProvider,
  useAudioContext,
} from "../context/AudioContextProvider";
import { useServices } from "../context/ServicesProvider";
import { useSettings } from "../context/SettingsProvider";
```

Removed: `useRouter` (line 3), `AntDesign` (line 5), `SafeAreaView` (line 17).

**Replace all `<SafeAreaView>` with `<View>`** in the three return paths:

Permission denied state (currently lines 119-130):

```tsx
<View style={styles.root}>
  <View style={styles.center}>...</View>
</View>
```

Loading state (currently lines 135-143):

```tsx
<View style={styles.root}>
  <View style={styles.center}>...</View>
</View>
```

Main content (currently lines 147-216):

```tsx
<View style={styles.root}>
  <View style={[styles.monitorCard, { borderColor: stateColor }]}>...</View>
  ...
</View>
```

**Remove the custom top bar JSX** (currently lines 148-161):

Delete the entire `<View style={styles.topBar}>...</View>` block. The `<View style={[styles.monitorCard, ...]}>` becomes the first child of the root `<View>`.

**Remove unused styles** from the `StyleSheet.create` call:

Delete these style definitions:

- `topBar` (lines 233-239)
- `appTitle` (lines 241-246)
- `settingsButton` (lines 247-249)
- `settingsButtonPressed` (lines 250-252)
- `settingsIconContainer` (lines 253-261)

**Remove the `router` variable** from `VoiceMirrorContent`:

Delete `const router = useRouter();` (currently line 45).

### File 3: `app/settings.tsx` (bonus cleanup)

While not strictly part of the navigation bar migration, the settings screen has a related issue: it uses `SafeAreaView` from `react-native` (the older, less reliable implementation) even though the native header is shown. This should be replaced with a plain `View` for consistency with the index screen change.

```tsx
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from "react-native";
```

And in the render:

```tsx
    <View style={styles.root}>
      <ScrollView ...>
        ...
      </ScrollView>
    </View>
```

## Files That Need Modification

| File                                | Change                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `app/_layout.tsx`                   | Enable native header on index screen, add `headerRight` with settings gear icon             |
| `src/screens/VoiceMirrorScreen.tsx` | Remove custom top bar, replace `SafeAreaView` with `View`, remove unused imports and styles |
| `app/settings.tsx`                  | Replace `SafeAreaView` with `View` (bonus cleanup)                                          |

## Considerations and Trade-offs

### Visual differences from the custom bar

The native header has platform-specific styling that differs from the custom top bar:

- **iOS:** Large title area with system font, right-aligned buttons get standard header padding (~16px from the right edge)
- **Android:** Material Design header with left-aligned title, buttons in the toolbar area

The custom bar used a 20px bold title with -0.5 letter spacing and a 40x40 bordered/rounded container around the gear icon. The native header will use the platform's default title styling (configured via `headerTitleStyle: { fontWeight: "600" }`) and the gear icon will sit directly in the header without a bordered container. This is intentional -- the goal is to use native appearance rather than custom design.

### Icon size adjustment

The current custom bar uses `size={20}` for the `AntDesign` setting icon inside a 40x40 container. In the native header, the icon should be slightly larger (`size={22}`) since it won't have the container background, making it the sole visual target. This is a standard size for navigation bar icons.

### No impact on E2E tests

The E2E tests (`e2e/specs/voiceMirror.spec.ts`) do not interact with the top bar or settings navigation. They test the voice recording lifecycle (idle -> recording -> playing -> idle), the pause/resume button (`~toggle-pause-button`), and swipe-to-delete on recordings. None of these selectors reference the custom top bar elements, so the migration will not break any E2E tests.

### No impact on unit tests

The unit tests under `src/hooks/__tests__/` and `src/components/__tests__/` test hooks and components in isolation. None of them render `VoiceMirrorScreen` or test navigation. The removal of the custom top bar from `VoiceMirrorScreen` has no effect on these tests.

### SafeAreaView removal safety

Removing `SafeAreaView` is safe because:

- The native Stack header handles the top inset
- The `contentStyle` in `screenOptions` already colors the content area correctly
- The bottom of the screen contains a `FlatList` (recordings list) which can handle its own content insets if needed
- The permission-denied and loading states center their content, so bottom inset padding is not critical

### Settings screen SafeAreaView cleanup

The settings screen (`app/settings.tsx`) imports `SafeAreaView` from `react-native` (the old API) rather than `react-native-safe-area-context` (the recommended library). Since the native header is shown on this screen, the `SafeAreaView` is redundant for the top inset and should be replaced with a plain `View`. This was likely missed during PR #39 which migrated to `react-native-safe-area-context`. Fixing it here keeps the change consistent across both screens.

## Todo

### Phase 1: Update `app/_layout.tsx` — Enable native header on index screen

- [x] Add `useRouter` import from `expo-router`
- [x] Add `AntDesign` import from `@expo/vector-icons`
- [x] Add `Pressable` to the existing `react-native` import destructuring
- [x] Add `const router = useRouter()` inside `RootStack` function
- [x] Update the `<Stack.Screen name="index">` options: remove `headerShown: false`
- [x] Add `title: "VoiceMirror"` to the index screen options
- [x] Add `headerShadowVisible: false` to the index screen options
- [x] Add `headerRight` render function with `Pressable` wrapping `AntDesign` setting icon (size 22, color `colors.textSecondary`)
- [x] Wire `headerRight` onPress to `router.push("/settings")`

### Phase 2: Update `src/screens/VoiceMirrorScreen.tsx` — Remove custom top bar

- [x] Remove `useRouter` import from `expo-router`
- [x] Remove `AntDesign` import from `@expo/vector-icons`
- [x] Remove `SafeAreaView` import from `react-native-safe-area-context`
- [x] Keep `Pressable` in `react-native` import (still used by pause button)
- [x] Remove `const router = useRouter()` from `VoiceMirrorContent`
- [x] Replace `<SafeAreaView style={styles.root}>` with `<View style={styles.root}>` in permission-denied return path
- [x] Replace `<SafeAreaView style={styles.root}>` with `<View style={styles.root}>` in loading return path
- [x] Replace `<SafeAreaView style={styles.root}>` with `<View style={styles.root}>` in main content return path
- [x] Remove the entire `<View style={styles.topBar}>...</View>` block from main content JSX
- [x] Remove `topBar` style definition from `StyleSheet.create`
- [x] Remove `appTitle` style definition from `StyleSheet.create`
- [x] Remove `settingsButton` style definition from `StyleSheet.create`
- [x] Remove `settingsButtonPressed` style definition from `StyleSheet.create`
- [x] Remove `settingsIconContainer` style definition from `StyleSheet.create`

### Phase 3: Update `app/settings.tsx` — Replace SafeAreaView with View (bonus cleanup)

- [x] Remove `SafeAreaView` from the `react-native` import destructuring
- [x] Ensure `View` is in the `react-native` import destructuring
- [x] Replace `<SafeAreaView style={styles.root}>` with `<View style={styles.root}>` in the render
- [x] Replace the closing `</SafeAreaView>` with `</View>`

### Phase 4: Verification

- [x] Run `pnpm typecheck` and confirm no type errors
- [x] Run `pnpm lint` and confirm no lint errors
- [x] Run `pnpm test:ci` and confirm all unit tests pass
- [x] Visually verify on iOS that the native header shows "VoiceMirror" title and settings gear icon
- [x] Visually verify on iOS that tapping the gear icon navigates to the settings screen
- [x] Visually verify on Android that the native header renders correctly
- [x] Verify no double top padding appears on devices with notch/Dynamic Island
- [x] Verify the settings screen still renders correctly after SafeAreaView removal
