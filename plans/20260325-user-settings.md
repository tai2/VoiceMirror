# User Settings Screen — Implementation Plan

## Goal

Allow users to configure the five voice detection parameters via slider controls on a new Settings screen, persisted with `@react-native-async-storage/async-storage`.

## Parameters to Expose

| Key | Label | Default | Min | Max | Step | Unit |
|---|---|---|---|---|---|---|
| `voiceThresholdDb` | Voice Threshold | -35 | -60 | -10 | 1 | dB |
| `voiceOnsetMs` | Voice Onset Duration | 250 | 50 | 1000 | 50 | ms |
| `silenceThresholdDb` | Silence Threshold | -45 | -70 | -10 | 1 | dB |
| `silenceDurationMs` | Silence Duration | 1500 | 300 | 5000 | 100 | ms |
| `minRecordingMs` | Min Recording Duration | 500 | 100 | 3000 | 100 | ms |

## Architecture

### Overview

```
AsyncStorage (5 keys)
    ↑ read/write
SettingsRepository (new, src/repositories/)
    ↑ injected via
SettingsProvider (new, src/context/)
    ↑ useSettings() hook
    ├── SettingsScreen (reads + writes)
    └── VoiceMirrorScreen → useVoiceMirror (reads)
```

### Navigation with Expo Router

The app currently uses a manual `registerRootComponent` + `App.tsx` entry point with no routing. We need to migrate to Expo Router's file-based routing.

## Step-by-Step Implementation

### Step 1: Install dependencies

```bash
pnpm add @react-native-async-storage/async-storage expo-router
```

### Step 2: Define settings types and defaults

Create `src/types/settings.ts`:

```typescript
export type DetectionSettings = {
  voiceThresholdDb: number;
  voiceOnsetMs: number;
  silenceThresholdDb: number;
  silenceDurationMs: number;
  minRecordingMs: number;
};

export const DEFAULT_SETTINGS: DetectionSettings = {
  voiceThresholdDb: -35,
  voiceOnsetMs: 250,
  silenceThresholdDb: -45,
  silenceDurationMs: 1500,
  minRecordingMs: 500,
};
```

### Step 3: Create SettingsRepository

Create `src/repositories/SettingsRepository.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type DetectionSettings, DEFAULT_SETTINGS } from '../types/settings';

const STORAGE_KEYS: Record<keyof DetectionSettings, string> = {
  voiceThresholdDb: 'setting:voiceThresholdDb',
  voiceOnsetMs: 'setting:voiceOnsetMs',
  silenceThresholdDb: 'setting:silenceThresholdDb',
  silenceDurationMs: 'setting:silenceDurationMs',
  minRecordingMs: 'setting:minRecordingMs',
};

export interface ISettingsRepository {
  load(): Promise<DetectionSettings>;
  save<K extends keyof DetectionSettings>(key: K, value: DetectionSettings[K]): Promise<void>;
}

export class RealSettingsRepository implements ISettingsRepository {
  async load(): Promise<DetectionSettings> {
    const keys = Object.values(STORAGE_KEYS);
    const pairs = await AsyncStorage.multiGet(keys);

    const settings = { ...DEFAULT_SETTINGS };
    for (const [storageKey, value] of pairs) {
      if (value === null) continue;
      const settingKey = Object.entries(STORAGE_KEYS).find(
        ([, v]) => v === storageKey,
      )?.[0] as keyof DetectionSettings | undefined;
      if (settingKey) {
        settings[settingKey] = Number(value);
      }
    }
    return settings;
  }

  async save<K extends keyof DetectionSettings>(
    key: K,
    value: DetectionSettings[K],
  ): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS[key], String(value));
  }
}
```

### Step 4: Create SettingsProvider context

Create `src/context/SettingsProvider.tsx`:

```typescript
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { type DetectionSettings, DEFAULT_SETTINGS } from '../types/settings';
import type { ISettingsRepository } from '../repositories/SettingsRepository';

type SettingsContextValue = {
  settings: DetectionSettings;
  loaded: boolean;
  updateSetting: <K extends keyof DetectionSettings>(
    key: K,
    value: DetectionSettings[K],
  ) => void;
};

const SettingsCtx = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({
  children,
  repository,
}: {
  children: React.ReactNode;
  repository: ISettingsRepository;
}) {
  const [settings, setSettings] = useState<DetectionSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    repository.load().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, [repository]);

  const updateSetting = useCallback(
    <K extends keyof DetectionSettings>(key: K, value: DetectionSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      repository.save(key, value);
    },
    [repository],
  );

  return (
    <SettingsCtx.Provider value={{ settings, loaded, updateSetting }}>
      {children}
    </SettingsCtx.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
```

### Step 5: Migrate to Expo Router

#### 5a. Update `package.json` main entry point

Change `"main"` from `"index.ts"` to `"expo-router/entry"`.

#### 5b. Update `app.json` — add scheme

```json
{
  "expo": {
    "scheme": "voicemirror",
    ...
  }
}
```

#### 5c. Create `app/_layout.tsx` (root layout)

Move the provider tree from `App.tsx` into the root layout:

```typescript
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { ServicesProvider } from '../src/context/ServicesProvider';
import { SettingsProvider } from '../src/context/SettingsProvider';
import { RealAudioRecordingService } from '../src/services/AudioRecordingService';
import { RealAudioEncoderService } from '../src/services/AudioEncoderService';
import { RealAudioDecoderService } from '../src/services/AudioDecoderService';
import { RealRecordingsRepository } from '../src/repositories/RecordingsRepository';
import { RealSettingsRepository } from '../src/repositories/SettingsRepository';

const services = {
  recordingService: new RealAudioRecordingService(),
  encoderService: new RealAudioEncoderService(),
  decoderService: new RealAudioDecoderService(),
  recordingsRepository: new RealRecordingsRepository(),
};

const settingsRepository = new RealSettingsRepository();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <ServicesProvider services={services}>
        <SettingsProvider repository={settingsRepository}>
          <Stack>
            <Stack.Screen
              name="index"
              options={{ title: 'VoiceMirror', headerShown: false }}
            />
            <Stack.Screen
              name="settings"
              options={{ title: 'Settings', presentation: 'card' }}
            />
          </Stack>
          <StatusBar style="dark" />
        </SettingsProvider>
      </ServicesProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
```

Note: E2E service switching logic (the `isE2E` / `E2EBanner` from current `App.tsx`) must be preserved — move it into the layout.

#### 5d. Create `app/index.tsx` (home screen)

```typescript
import { VoiceMirrorScreen } from '../src/screens/VoiceMirrorScreen';

export default VoiceMirrorScreen;
```

#### 5e. Delete `App.tsx` and `index.ts`

These are replaced by the Expo Router entry point and `app/_layout.tsx`.

### Step 6: Create the Settings screen

Create `app/settings.tsx`:

```typescript
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';  // or RN built-in
import { SafeAreaView } from 'react-native';
import { useSettings } from '../src/context/SettingsProvider';
import type { DetectionSettings } from '../src/types/settings';
import { DEFAULT_SETTINGS } from '../src/types/settings';

type SliderConfig = {
  key: keyof DetectionSettings;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

const SLIDERS: SliderConfig[] = [
  {
    key: 'voiceThresholdDb',
    label: 'Voice Threshold',
    description:
      'Audio level (in dB) that must be exceeded to begin voice onset detection. Lower values make detection more sensitive to quiet speech; higher values require louder input.',
    min: -60,
    max: -10,
    step: 1,
    unit: 'dB',
  },
  {
    key: 'voiceOnsetMs',
    label: 'Voice Onset Duration',
    description:
      'How long (in ms) the audio must stay above the voice threshold before recording starts. Shorter values react faster but may trigger on brief noises; longer values are more conservative.',
    min: 50,
    max: 1000,
    step: 50,
    unit: 'ms',
  },
  {
    key: 'silenceThresholdDb',
    label: 'Silence Threshold',
    description:
      'Audio level (in dB) below which silence detection begins. Should be lower than the voice threshold. Lower values tolerate more background noise before ending a recording.',
    min: -70,
    max: -10,
    step: 1,
    unit: 'dB',
  },
  {
    key: 'silenceDurationMs',
    label: 'Silence Duration',
    description:
      'How long (in ms) silence must persist before the recording ends. Longer values allow natural pauses in speech without cutting off; shorter values end recordings faster.',
    min: 300,
    max: 5000,
    step: 100,
    unit: 'ms',
  },
  {
    key: 'minRecordingMs',
    label: 'Min Recording Duration',
    description:
      'Minimum amount of speech (in ms) that must be captured before silence can end the recording. Prevents very short accidental recordings.',
    min: 100,
    max: 3000,
    step: 100,
    unit: 'ms',
  },
];

function SettingSlider({ config }: { config: SliderConfig }) {
  const { settings, updateSetting } = useSettings();
  const value = settings[config.key];

  return (
    <View style={styles.sliderCard}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{config.label}</Text>
        <Text style={styles.sliderValue}>
          {value} {config.unit}
        </Text>
      </View>
      <Text style={styles.sliderDescription}>{config.description}</Text>
      <Slider
        minimumValue={config.min}
        maximumValue={config.max}
        step={config.step}
        value={value}
        onValueChange={(v) => updateSetting(config.key, v)}
        minimumTrackTintColor="#4A9EFF"
        maximumTrackTintColor="#DDD"
      />
      <View style={styles.sliderRange}>
        <Text style={styles.rangeLabel}>
          {config.min} {config.unit}
        </Text>
        <Text style={styles.defaultLabel}>
          default: {DEFAULT_SETTINGS[config.key]} {config.unit}
        </Text>
        <Text style={styles.rangeLabel}>
          {config.max} {config.unit}
        </Text>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {SLIDERS.map((config) => (
          <SettingSlider key={config.key} config={config} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 40 },
  sliderCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderLabel: { fontSize: 16, fontWeight: '600', color: '#333' },
  sliderValue: { fontSize: 16, fontWeight: '700', color: '#4A9EFF' },
  sliderDescription: { fontSize: 13, color: '#888', lineHeight: 18 },
  sliderRange: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rangeLabel: { fontSize: 11, color: '#AAA' },
  defaultLabel: { fontSize: 11, color: '#AAA', fontStyle: 'italic' },
});
```

Note: React Native ships a built-in `Slider` (deprecated) — use `@react-native-community/slider` instead. Add it: `pnpm add @react-native-community/slider`.

### Step 7: Add navigation to Settings from VoiceMirrorScreen

Add a gear icon button in `VoiceMirrorScreen` that navigates to settings:

```typescript
import { useRouter } from 'expo-router';

// Inside VoiceMirrorContent:
const router = useRouter();

// In the JSX, add a settings button in the top-right area:
<Pressable onPress={() => router.push('/settings')} style={styles.settingsButton}>
  <Text style={styles.settingsIcon}>⚙</Text>
</Pressable>
```

### Step 8: Wire settings into useVoiceMirror

#### 8a. Add settings parameter to the hook

```typescript
import type { DetectionSettings } from '../types/settings';

export function useVoiceMirror(
  onRecordingComplete: RecordingCompleteCallback,
  audioContext: AudioContext | null,
  recordingService: IAudioRecordingService,
  encoderService: IAudioEncoderService,
  repository: IRecordingsRepository,
  settings: DetectionSettings,            // ← new parameter
): VoiceMirrorState {
```

#### 8b. Replace constant imports with settings values

In `tickStateMachine`, replace the imported constants with values from the `settings` parameter. Since `tickStateMachine` is an inner function, it can close over the hook arguments. Store settings in a ref to keep the callback stable:

```typescript
const settingsRef = useRef(settings);
settingsRef.current = settings;

function tickStateMachine(db: number, totalFrames: number, sampleRate: number) {
  const now = Date.now();
  const s = settingsRef.current;

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
  } else if (phaseRef.current === 'recording') {
    const speechMs = ((totalFrames - voiceStartFrameRef.current) / sampleRate) * 1000;

    if (db < s.silenceThresholdDb && speechMs >= s.minRecordingMs) {
      if (silenceStartTimeRef.current === null) {
        silenceStartTimeRef.current = now;
      } else if (now - silenceStartTimeRef.current >= s.silenceDurationMs) {
        silenceStartTimeRef.current = null;
        phaseRef.current = 'playing';
        setPhase('playing');
        void stopAndPlay();
      }
    } else if (db >= s.silenceThresholdDb) {
      silenceStartTimeRef.current = null;
    }
  }
}
```

#### 8c. Update call site in VoiceMirrorScreen

```typescript
import { useSettings } from '../context/SettingsProvider';

function VoiceMirrorContent() {
  const { settings } = useSettings();
  // ...
  const { phase, ... } = useVoiceMirror(
    stableAddRecording,
    audioContext,
    recordingService,
    encoderService,
    recordingsRepository,
    settings,                              // ← pass settings
  );
}
```

### Step 9: Update constants/audio.ts

The five configurable constants move into `DEFAULT_SETTINGS`. The remaining non-configurable constants (`SAMPLE_RATE`, `LEVEL_HISTORY_SIZE`, `DB_FLOOR`, `DB_CEIL`) stay in `constants/audio.ts`. Remove the five migrated exports:

```typescript
// constants/audio.ts — after migration
export const SAMPLE_RATE = 44100;
export const LEVEL_HISTORY_SIZE = 40;
export const DB_FLOOR = -70;
export const DB_CEIL = -10;
```

### Step 10: Update unit tests

The existing `useVoiceMirror.test.ts` imports constants from `constants/audio.ts`. After migration:

- Import `DEFAULT_SETTINGS` from `types/settings` instead.
- Pass `DEFAULT_SETTINGS` as the new `settings` argument to `useVoiceMirror` in test `renderHook` calls.
- Tests that override thresholds can spread `DEFAULT_SETTINGS` with custom values.

### Step 11: Add SettingsRepository to ServicesProvider

Two options:

**Option A (chosen)**: Keep `SettingsProvider` separate from `ServicesProvider`. The settings concern is orthogonal to the audio services. The `SettingsProvider` wraps around the `Stack` in `_layout.tsx` and takes its own repository.

**Option B**: Add `ISettingsRepository` to the `Services` type. This couples settings storage to audio services — not ideal.

### Step 12: Add to ServicesProvider for testability

For the settings repository, add it as a separate field on `Services` so that E2E and unit tests can provide stubs:

Actually, `SettingsProvider` already accepts `repository` as a prop, so tests can pass a stub directly. No change to `ServicesProvider` needed.

## File Changes Summary

| Action | File |
|---|---|
| **Create** | `src/types/settings.ts` |
| **Create** | `src/repositories/SettingsRepository.ts` |
| **Create** | `src/context/SettingsProvider.tsx` |
| **Create** | `app/_layout.tsx` |
| **Create** | `app/index.tsx` |
| **Create** | `app/settings.tsx` |
| **Delete** | `App.tsx` |
| **Delete** | `index.ts` |
| **Modify** | `package.json` (main entry, new deps) |
| **Modify** | `app.json` (add scheme) |
| **Modify** | `src/hooks/useVoiceMirror.ts` (accept settings param, use ref) |
| **Modify** | `src/screens/VoiceMirrorScreen.tsx` (pass settings, add nav button) |
| **Modify** | `src/constants/audio.ts` (remove migrated constants) |
| **Modify** | `src/hooks/__tests__/useVoiceMirror.test.ts` (pass settings) |

## Dependencies to Install

```bash
pnpm add @react-native-async-storage/async-storage expo-router @react-native-community/slider
```

## Todo List

### Phase 1: Dependencies and Foundation

- [x] Install `@react-native-async-storage/async-storage`, `expo-router`, `@react-native-community/slider`
- [x] Create `src/types/settings.ts` — `DetectionSettings` type and `DEFAULT_SETTINGS`

### Phase 2: Settings Data Layer

- [x] Create `src/repositories/SettingsRepository.ts` — `ISettingsRepository` interface + `RealSettingsRepository`
  - [x] `load()` — read all 5 keys from AsyncStorage, fall back to defaults
  - [x] `save(key, value)` — write a single key to AsyncStorage
- [x] Create `src/context/SettingsProvider.tsx` — context + `useSettings()` hook
  - [x] `SettingsProvider` component that accepts `repository` prop
  - [x] Load settings on mount, expose `settings`, `loaded`, `updateSetting`

### Phase 3: Migrate to Expo Router

- [x] Update `package.json` — change `"main"` to `"expo-router/entry"`
- [x] Update `app.json` — add `"scheme": "voicemirror"`
- [x] Create `app/_layout.tsx` — root layout with `Stack` navigator
  - [x] Move `GestureHandlerRootView`, `ServicesProvider`, `StatusBar` from `App.tsx`
  - [x] Add `SettingsProvider` wrapping the `Stack`
  - [x] Preserve E2E service switching logic and `E2EBanner`
  - [x] Define two stack screens: `index` (headerShown: false) and `settings`
- [x] Create `app/index.tsx` — re-export `VoiceMirrorScreen`
- [x] Delete `App.tsx`
- [x] Delete `index.ts`
- [x] Verify the app boots correctly with Expo Router (typecheck, manual run)

### Phase 4: Settings Screen UI

- [x] Create `app/settings.tsx`
  - [x] Define `SliderConfig` type and `SLIDERS` array with all 5 parameter configs (label, description, min, max, step, unit)
  - [x] `SettingSlider` component — reads/writes via `useSettings()`, shows label, current value, description, slider, min/max/default labels
  - [x] `SettingsScreen` — `ScrollView` rendering all 5 `SettingSlider` cards

### Phase 5: Wire Settings into VoiceMirror

- [x] Modify `src/constants/audio.ts` — remove the 5 migrated constants, keep `SAMPLE_RATE`, `LEVEL_HISTORY_SIZE`, `DB_FLOOR`, `DB_CEIL`
- [x] Modify `src/hooks/useVoiceMirror.ts`
  - [x] Add `settings: DetectionSettings` parameter
  - [x] Add `settingsRef` to keep settings accessible in callbacks
  - [x] Replace 5 constant references in `tickStateMachine` with `settingsRef.current.*`
  - [x] Remove unused imports from `constants/audio`
- [x] Modify `src/screens/VoiceMirrorScreen.tsx`
  - [x] Import and call `useSettings()` to get current settings
  - [x] Pass `settings` to `useVoiceMirror()`
  - [x] Add settings navigation button (gear icon) that calls `router.push('/settings')`
  - [x] Add styles for the settings button

### Phase 6: Update Tests

- [x] Modify `src/hooks/__tests__/useVoiceMirror.test.ts`
  - [x] Import `DEFAULT_SETTINGS` from `types/settings` instead of individual constants from `constants/audio`
  - [x] Pass `DEFAULT_SETTINGS` as the `settings` argument in all `renderHook` calls
  - [x] Update any constant references used in test assertions
- [x] Update `e2e/helpers/E2EAudioBridge.ts` — import thresholds from `DEFAULT_SETTINGS`
- [x] Update `e2e/specs/voiceMirror.spec.ts` — import timing constants from `DEFAULT_SETTINGS`

### Phase 7: Verification

- [x] `pnpm typecheck` passes
- [x] `pnpm typecheck:e2e` passes
- [x] `pnpm lint` passes
- [x] `pnpm test:ci` passes (63/63 tests)
- [ ] Manual test: open Settings screen, adjust sliders, verify values persist across app restarts
- [ ] Manual test: change voice threshold, verify detection behavior changes on VoiceMirror screen

## Risks and Notes

- **Expo Router migration**: This is the biggest structural change. It replaces the manual entry point (`index.ts` + `App.tsx`) with file-based routing (`app/` directory). The E2E banner and service switching logic must be carefully moved into `app/_layout.tsx`.
- **Settings take effect immediately**: Since `useVoiceMirror` reads from a ref that's updated on every render, changing a slider while recording will apply the new threshold to the _current_ detection cycle. This is the desired behavior — no restart needed.
- **No validation between settings**: The UI doesn't prevent `silenceThresholdDb > voiceThresholdDb` (which would break hysteresis). Consider adding a warning in the UI if this occurs, but don't block the user.
