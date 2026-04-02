# Reset Settings to Defaults — Implementation Plan

## Goal

Add a "Reset to Defaults" button to the Settings screen that restores all 7 settings to their `DEFAULT_SETTINGS` values in a single action. The button should require user confirmation before proceeding, since the action is destructive and cannot be undone.

## Architecture / Approach

The change touches four layers of the existing settings architecture:

```
AsyncStorage (7 keys removed)
    ^ resetAll()
ISettingsRepository / RealSettingsRepository
    ^ resetSettings()
SettingsProvider (context)
    ^ called from
Settings screen (button + Alert confirmation)
```

### 1. Repository layer: add `resetAll()` to `ISettingsRepository`

The `ISettingsRepository` interface currently has two methods: `load()` and `save()`. A new `resetAll()` method removes all 7 `setting:*` keys from AsyncStorage in one batch using `AsyncStorage.multiRemove()`. This is cleaner than calling `save()` 7 times with default values, and it means "reset" semantically means "remove overrides, fall back to defaults" rather than "write default values."

**File: `src/repositories/SettingsRepository.ts`**

Add to the interface:

```typescript
export interface ISettingsRepository {
  load(): Promise<AppSettings>;
  save<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>;
  resetAll(): Promise<void>;
}
```

Add to `RealSettingsRepository`:

```typescript
async resetAll(): Promise<void> {
  const keys = Object.values(STORAGE_KEYS);
  await AsyncStorage.multiRemove(keys);
}
```

### 2. Context layer: expose `resetSettings()` from `SettingsProvider`

The `SettingsContextValue` type gains a new function `resetSettings()`. This function:
1. Sets in-memory state to `DEFAULT_SETTINGS` (optimistic update, same pattern as `updateSetting`).
2. Calls `repository.resetAll()` fire-and-forget (same pattern as existing `save()` calls).

**File: `src/context/SettingsProvider.tsx`**

Update the context value type:

```typescript
type SettingsContextValue = {
  settings: AppSettings;
  loaded: boolean;
  updateSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void;
  resetSettings: () => void;
};
```

Add the callback inside `SettingsProvider`:

```typescript
const resetSettings = useCallback(() => {
  setSettings(DEFAULT_SETTINGS);
  void repository.resetAll();
}, [repository]);
```

Update the provider value:

```typescript
<SettingsCtx.Provider value={{ settings, loaded, updateSetting, resetSettings }}>
```

### 3. UI layer: add the reset button to the Settings screen

A `Pressable` button is placed at the bottom of the `ScrollView`, below all slider cards. When tapped, it shows a native `Alert.alert` confirmation dialog with "Cancel" and "Reset" options. If confirmed, it calls `resetSettings()` from the context.

The button uses a subdued danger-style appearance (not bright red, but clearly distinct from the slider cards) that fits the existing dark theme.

**File: `app/settings.tsx`**

Add imports:

```typescript
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Pressable, Alert } from "react-native";
```

Add the reset handler and button inside `SettingsScreen`:

```typescript
export default function SettingsScreen() {
  const { t } = useTranslation();
  const { resetSettings } = useSettings();

  const handleReset = () => {
    Alert.alert(
      t("settings.reset_confirm_title"),
      t("settings.reset_confirm_message"),
      [
        { text: t("settings.reset_cancel"), style: "cancel" },
        {
          text: t("settings.reset_confirm"),
          style: "destructive",
          onPress: () => resetSettings(),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {SLIDERS.map((config) => (
          <SettingSlider key={config.key} config={config} />
        ))}
        <Pressable
          style={({ pressed }) => [
            styles.resetButton,
            pressed && styles.resetButtonPressed,
          ]}
          onPress={handleReset}
        >
          <Text style={styles.resetButtonText}>
            {t("settings.reset_button")}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
```

Add styles for the button:

```typescript
resetButton: {
  backgroundColor: colors.surface,
  borderRadius: 16,
  padding: 16,
  alignItems: "center",
  borderWidth: 1,
  borderColor: colors.border,
},
resetButtonPressed: {
  opacity: 0.7,
},
resetButtonText: {
  fontSize: 15,
  fontWeight: "600",
  color: "#EF4444",
},
```

### 4. i18n: add translation keys

**File: `src/i18n/locales/en/translation.json`**

```json
"settings.reset_button": "Reset to Defaults",
"settings.reset_confirm_title": "Reset Settings",
"settings.reset_confirm_message": "Are you sure you want to reset all settings to their default values?",
"settings.reset_confirm": "Reset",
"settings.reset_cancel": "Cancel"
```

**File: `src/i18n/locales/ja/translation.json`**

```json
"settings.reset_button": "デフォルトに戻す",
"settings.reset_confirm_title": "設定のリセット",
"settings.reset_confirm_message": "すべての設定をデフォルト値に戻しますか？",
"settings.reset_confirm": "リセット",
"settings.reset_cancel": "キャンセル"
```

### 5. Test stubs: update stub repository

Any test that creates a stub `ISettingsRepository` needs the new `resetAll` method. The existing test infrastructure creates inline stubs or uses the stub files.

**File: `src/__tests__/stubs/` (if a settings stub exists, or inline in test files)**

Check if any existing tests mock `ISettingsRepository`. If so, add `resetAll: jest.fn()` to the mock. The `useVoiceMirror` and `useRecordings` tests do not directly mock the settings repository (they receive settings as props/arguments), so this may only affect future tests or the settings screen tests if they exist.

## Files That Need Modification

| File | Change |
|---|---|
| `src/repositories/SettingsRepository.ts` | Add `resetAll()` to interface and implementation |
| `src/context/SettingsProvider.tsx` | Add `resetSettings` to context value type and provider |
| `app/settings.tsx` | Add reset button with `Alert` confirmation |
| `src/i18n/locales/en/translation.json` | Add 5 new translation keys |
| `src/i18n/locales/ja/translation.json` | Add 5 new translation keys |

## Considerations and Trade-offs

### Using `multiRemove` vs writing defaults

The plan uses `AsyncStorage.multiRemove()` to delete stored keys rather than writing `DEFAULT_SETTINGS` values back. This means "reset" semantically means "remove all overrides" and the next `load()` naturally falls back to `DEFAULT_SETTINGS` via the existing spread-and-merge logic. The advantage is that if `DEFAULT_SETTINGS` changes in a future app update, a user who previously reset will get the new defaults. The downside is negligible: one extra `multiRemove` API to learn. If we instead wrote default values, a future change to `DEFAULT_SETTINGS` would not propagate to users who had previously reset.

### Confirmation dialog with `Alert.alert`

React Native's built-in `Alert.alert` is used rather than a custom modal. This is the simplest approach, renders natively on both iOS and Android, and requires no additional dependencies. The "destructive" button style on iOS renders the confirm button in red, which is the standard UX for irreversible actions. On Android, the alert renders as a standard Material dialog. There are no existing `Alert` usages in the codebase, but this is idiomatic React Native and does not conflict with any existing patterns.

### Button placement

The reset button is placed at the bottom of the scroll view, after all slider cards. This keeps it out of the way during normal slider adjustments but easily reachable by scrolling down. An alternative would be placing it in the navigation header bar, but that would be less discoverable and harder to add a confirmation step to.

### No partial reset

This plan implements an all-or-nothing reset. There is no per-slider reset button. Individual sliders already show their default values in the footer badge (e.g., "default: -35 dB"), so users can manually return individual sliders. Adding per-slider reset buttons would increase UI complexity significantly for marginal benefit, and can be considered as a future enhancement.

### Impact on active recording

If a user resets settings while a recording is in progress, the new default values will take effect on the very next `tickStateMachine` call (within ~100ms), since `useVoiceMirror` reads settings from a ref. This is the same behavior as adjusting individual sliders during recording -- it is already the established pattern and does not require special handling.

### Fire-and-forget persistence consistency

The `resetSettings()` function follows the same fire-and-forget pattern as the existing `updateSetting()`: state is updated optimistically, and the async storage operation is not awaited. If `multiRemove` fails, the in-memory state shows defaults for the current session but persisted values remain unchanged for the next app launch. This matches the existing trade-off documented in the codebase.

## Todo

### 1. Repository layer

- [x] Add `resetAll(): Promise<void>` to the `ISettingsRepository` interface in `src/repositories/SettingsRepository.ts`
- [x] Implement `resetAll()` in `RealSettingsRepository` using `Promise.all` + `removeItem` (AsyncStorage lacks `multiRemove`)

### 2. Context layer

- [x] Add `resetSettings: () => void` to the `SettingsContextValue` type in `src/context/SettingsProvider.tsx`
- [x] Implement `resetSettings` callback with `useCallback` that calls `setSettings(DEFAULT_SETTINGS)` and `void repository.resetAll()`
- [x] Add `resetSettings` to the `SettingsCtx.Provider` value object

### 3. UI layer

- [x] Add `Pressable` and `Alert` to the `react-native` import in `app/settings.tsx`
- [x] Import `useTranslation` hook in `SettingsScreen` component (already imported at module level, use it in the component)
- [x] Destructure `resetSettings` from `useSettings()` in `SettingsScreen`
- [x] Add `handleReset` function that shows `Alert.alert` with confirmation dialog and calls `resetSettings()` on confirm
- [x] Add `Pressable` reset button below the `SLIDERS.map(...)` block inside the `ScrollView`
- [x] Add `resetButton`, `resetButtonPressed`, and `resetButtonText` styles to the `StyleSheet`

### 4. i18n

- [x] Add `settings.reset_button` key to `src/i18n/locales/en/translation.json` ("Reset to Defaults")
- [x] Add `settings.reset_confirm_title` key to `src/i18n/locales/en/translation.json` ("Reset Settings")
- [x] Add `settings.reset_confirm_message` key to `src/i18n/locales/en/translation.json`
- [x] Add `settings.reset_confirm` key to `src/i18n/locales/en/translation.json` ("Reset")
- [x] Add `settings.reset_cancel` key to `src/i18n/locales/en/translation.json` ("Cancel")
- [x] Add `settings.reset_button` key to `src/i18n/locales/ja/translation.json` ("デフォルトに戻す")
- [x] Add `settings.reset_confirm_title` key to `src/i18n/locales/ja/translation.json` ("設定のリセット")
- [x] Add `settings.reset_confirm_message` key to `src/i18n/locales/ja/translation.json`
- [x] Add `settings.reset_confirm` key to `src/i18n/locales/ja/translation.json` ("リセット")
- [x] Add `settings.reset_cancel` key to `src/i18n/locales/ja/translation.json` ("キャンセル")

### 5. Test stubs and updates

- [x] Add `resetAll: jest.fn()` to any inline `ISettingsRepository` mocks if they exist in test files — N/A, no existing mocks found
- [x] Verify no existing tests break by running `pnpm test:ci`

### 6. Verification

- [x] Run `pnpm typecheck` and confirm no type errors
- [x] Run `pnpm lint` and confirm no lint errors
- [x] Run `pnpm test:ci` and confirm all tests pass
