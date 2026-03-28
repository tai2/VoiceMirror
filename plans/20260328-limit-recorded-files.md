# Limit Recorded Files (FIFO) -- Implementation Plan

## Goal

Prevent unbounded growth of recorded audio files by enforcing a configurable maximum number of recordings. When a new recording is added and the count exceeds the cap, the oldest recordings are automatically deleted (FIFO order). The cap is user-configurable from the Settings screen and persisted via AsyncStorage, following the same patterns as the existing detection settings.

## Architecture / Approach

### Where the cap is enforced

The enforcement point is `useRecordings.addRecording()`. This is the single place where new recordings enter the list. After prepending the new entry and before saving, the hook trims the list to the cap size, deleting both the index entries and the on-disk M4A files for any evicted recordings.

This approach is simple and reliable: the recordings list is the source of truth, and the cap is applied at the moment of insertion. There is no need for a background cleanup job or a separate file-scanning mechanism.

### Settings integration

The existing settings system uses `DetectionSettings` (a flat object of number-valued keys) with a `SettingsProvider` context that loads/saves via `ISettingsRepository` and `AsyncStorage`. The new `maxRecordings` setting fits naturally into this system.

The current `DetectionSettings` type will be renamed to `AppSettings` to reflect that it now contains both detection parameters and general app settings. A new `maxRecordings` field is added with a default of 50. The value 0 means "unlimited" (no cap).

The settings screen already renders sliders from a `SLIDERS` config array. A new entry is appended for the max recordings cap.

### Data flow

```
User speaks -> useVoiceMirror -> onRecordingComplete(filePath, durationMs)
                                        |
                                        v
                              useRecordings.addRecording()
                                        |
                        1. Prepend new Recording to list
                        2. If maxRecordings > 0 and list.length > maxRecordings:
                           a. Identify excess = list.slice(maxRecordings)
                           b. Delete each excess recording's M4A file via repository.deleteFile()
                           c. Trim list to list.slice(0, maxRecordings)
                        3. Save trimmed list via repository.save()
```

### How maxRecordings reaches useRecordings

The `useRecordings` hook currently does not receive settings. Rather than adding the full `AppSettings` object as a dependency (which would cause unnecessary re-renders and effect re-runs), the cap value will be passed as a single `maxRecordings: number` parameter. The `VoiceMirrorScreen` reads it from `useSettings()` and passes it down.

Inside `useRecordings`, a ref (`maxRecordingsRef`) holds the latest value so the `addRecording` callback always sees the current cap without needing to be recreated.

## Code Changes

### 1. Rename `DetectionSettings` to `AppSettings` and add `maxRecordings`

**File: `src/types/settings.ts`**

```typescript
export type AppSettings = {
  voiceThresholdDb: number;
  voiceOnsetMs: number;
  silenceThresholdDb: number;
  silenceDurationMs: number;
  minRecordingMs: number;
  maxRecordings: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  voiceThresholdDb: -35,
  voiceOnsetMs: 250,
  silenceThresholdDb: -45,
  silenceDurationMs: 1500,
  minRecordingMs: 500,
  maxRecordings: 50,
};

/** Detection-only subset, for useVoiceMirror's parameter type. */
export type DetectionSettings = Omit<AppSettings, 'maxRecordings'>;
```

The `DetectionSettings` type is kept as an alias (`Omit<AppSettings, 'maxRecordings'>`) so that `useVoiceMirror` continues to accept only detection-related settings and does not need changes. All existing imports of `DetectionSettings` remain valid.

### 2. Add storage key for `maxRecordings`

**File: `src/repositories/SettingsRepository.ts`**

Add the new key to `STORAGE_KEYS`:

```typescript
const STORAGE_KEYS: Record<keyof AppSettings, string> = {
  voiceThresholdDb: 'setting:voiceThresholdDb',
  voiceOnsetMs: 'setting:voiceOnsetMs',
  silenceThresholdDb: 'setting:silenceThresholdDb',
  silenceDurationMs: 'setting:silenceDurationMs',
  minRecordingMs: 'setting:minRecordingMs',
  maxRecordings: 'setting:maxRecordings',
};
```

Update the interface and class to use `AppSettings` instead of `DetectionSettings`:

```typescript
import { type AppSettings, DEFAULT_SETTINGS } from '../types/settings';

export interface ISettingsRepository {
  load(): Promise<AppSettings>;
  save<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>;
}

export class RealSettingsRepository implements ISettingsRepository {
  async load(): Promise<AppSettings> {
    // ... same logic, but typed as AppSettings
  }

  async save<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS[key], String(value));
  }
}
```

### 3. Update `SettingsProvider` to use `AppSettings`

**File: `src/context/SettingsProvider.tsx`**

Replace all references to `DetectionSettings` with `AppSettings`:

```typescript
import { type AppSettings, DEFAULT_SETTINGS } from '../types/settings';

type SettingsContextValue = {
  settings: AppSettings;
  loaded: boolean;
  updateSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void;
};
```

### 4. Pass `maxRecordings` to `useRecordings` and enforce the cap

**File: `src/hooks/useRecordings.ts`**

Add a `maxRecordings` parameter and enforce the FIFO cap inside `addRecording`:

```typescript
export function useRecordings(
  options: RecordingsOptions,
  audioContext: AudioContext | null,
  repository: IRecordingsRepository,
  decoderService: IAudioDecoderService,
  maxRecordings: number,               // <-- new parameter
): RecordingsState {
  // ...existing state...

  const maxRecordingsRef = useRef(maxRecordings);
  maxRecordingsRef.current = maxRecordings;

  const addRecording = useCallback((filePath: string, durationMs: number) => {
    const entry: Recording = {
      id: String(Date.now()),
      filePath: 'file://' + filePath,
      recordedAt: new Date().toISOString(),
      durationMs,
    };
    let next = [entry, ...recordingsRef.current];

    const cap = maxRecordingsRef.current;
    if (cap > 0 && next.length > cap) {
      const excess = next.slice(cap);
      for (const r of excess) {
        repositoryRef.current.deleteFile(r.filePath.replace('file://', ''));
      }
      next = next.slice(0, cap);
    }

    setRecordings(next);
    repositoryRef.current.save(next);
  }, []);

  // ...rest unchanged...
}
```

### 5. Wire `maxRecordings` through `VoiceMirrorScreen`

**File: `src/screens/VoiceMirrorScreen.tsx`**

Pass the setting value from the context to `useRecordings`:

```typescript
const { settings } = useSettings();

const { recordings, playState, addRecording, deleteRecording, togglePlay } = useRecordings(
  { onWillPlay: stableSuspend, onDidStop: stableResume },
  audioContext,
  recordingsRepository,
  decoderService,
  settings.maxRecordings,               // <-- new argument
);
```

### 6. Add slider for `maxRecordings` on the Settings screen

**File: `app/settings.tsx`**

Import `AppSettings` instead of `DetectionSettings` and add a new entry to the `SLIDERS` array:

```typescript
import type { AppSettings } from '../src/types/settings';

type SliderConfig = {
  key: keyof AppSettings;
  labelKey: string;
  descriptionKey: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  formatValue?: (v: number) => string;
};

const SLIDERS: SliderConfig[] = [
  // ...existing 5 entries...
  {
    key: 'maxRecordings',
    labelKey: 'settings.max_recordings_label',
    descriptionKey: 'settings.max_recordings_description',
    min: 0,
    max: 200,
    step: 5,
    unit: '',
    formatValue: (v: number) => v === 0 ? t('settings.max_recordings_unlimited') : String(v),
  },
];
```

Since the value 0 means "unlimited" and needs special display formatting, the `SettingSlider` component needs a small update to support a `formatValue` function:

```typescript
function SettingSlider({ config }: { config: SliderConfig }) {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const value = settings[config.key];

  const displayValue = config.formatValue
    ? config.formatValue(value)
    : `${value} ${config.unit}`;

  return (
    <View style={styles.sliderCard}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{t(config.labelKey)}</Text>
        <Text style={styles.sliderValue}>{displayValue}</Text>
      </View>
      {/* ...rest unchanged... */}
    </View>
  );
}
```

However, since `formatValue` needs access to `t` for the "unlimited" string, and the `SLIDERS` array is defined at module level, a cleaner approach is to handle the special case directly in the `SettingSlider` component. Instead of `formatValue`, check the key:

```typescript
function SettingSlider({ config }: { config: SliderConfig }) {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const value = settings[config.key];

  const displayValue = config.key === 'maxRecordings' && value === 0
    ? t('settings.max_recordings_unlimited')
    : `${value} ${config.unit}`;

  return (
    <View style={styles.sliderCard}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{t(config.labelKey)}</Text>
        <Text style={styles.sliderValue}>{displayValue}</Text>
      </View>
      {/* ...rest unchanged... */}
    </View>
  );
}
```

### 7. Add i18n translation keys

**File: `src/i18n/locales/en/translation.json`**

```json
{
  "settings.max_recordings_label": "Max Recordings",
  "settings.max_recordings_description": "Maximum number of recordings to keep. When a new recording is added and the limit is reached, the oldest recordings are automatically deleted. Set to 0 for unlimited.",
  "settings.max_recordings_unlimited": "Unlimited"
}
```

**File: `src/i18n/locales/ja/translation.json`**

```json
{
  "settings.max_recordings_label": "最大録音数",
  "settings.max_recordings_description": "保持する録音の最大数。新しい録音が追加され上限に達すると、古い録音が自動的に削除されます。0で無制限。",
  "settings.max_recordings_unlimited": "無制限"
}
```

### 8. Update unit tests

**File: `src/hooks/__tests__/useRecordings.test.ts`**

Update the `setup` helper to pass `maxRecordings`:

```typescript
function setup(initialRecordings: Recording[] = [], maxRecordings = 0) {
  // ...existing setup...
  const { result } = renderHook(() =>
    useRecordings({ onWillPlay, onDidStop }, audioContext, repository, decoderService, maxRecordings),
  );
  return { result, repository, decoderService, audioContext, onWillPlay, onDidStop };
}
```

Add new test cases:

```typescript
describe('useRecordings -- FIFO cap enforcement', () => {
  it('trims oldest recordings when adding exceeds maxRecordings', async () => {
    const r1 = makeRecording({ id: '1' });
    const r2 = makeRecording({ id: '2', filePath: 'file:///tmp/recording_2.m4a' });
    const { result } = setup([r1, r2], 2);
    await waitFor(() => expect(result.current.recordings).toHaveLength(2));

    act(() => { result.current.addRecording('/tmp/new.m4a', 1000); });

    expect(result.current.recordings).toHaveLength(2);
    expect(result.current.recordings[0].filePath).toBe('file:///tmp/new.m4a');
    expect(result.current.recordings[1].id).toBe('1');
  });

  it('deletes the M4A files for evicted recordings', async () => {
    const r1 = makeRecording({ id: '1', filePath: 'file:///tmp/r1.m4a' });
    const r2 = makeRecording({ id: '2', filePath: 'file:///tmp/r2.m4a' });
    const { result, repository } = setup([r1, r2], 2);
    await waitFor(() => expect(result.current.recordings).toHaveLength(2));

    act(() => { result.current.addRecording('/tmp/new.m4a', 1000); });

    expect(repository.deleteFile).toHaveBeenCalledWith('/tmp/r2.m4a');
  });

  it('does not trim when maxRecordings is 0 (unlimited)', async () => {
    const r1 = makeRecording({ id: '1' });
    const { result } = setup([r1], 0);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    act(() => { result.current.addRecording('/tmp/new.m4a', 1000); });

    expect(result.current.recordings).toHaveLength(2);
  });
});
```

**File: `src/hooks/__tests__/useVoiceMirror.test.ts`**

No changes needed. `useVoiceMirror` still accepts `DetectionSettings` (now an `Omit` alias), and `DEFAULT_SETTINGS` still satisfies it via structural typing since it has all the required fields plus `maxRecordings` which is simply ignored.

## Files That Need Modification

| File | Change |
|------|--------|
| `src/types/settings.ts` | Rename `DetectionSettings` to `AppSettings`, add `maxRecordings`, re-export `DetectionSettings` as `Omit` alias |
| `src/repositories/SettingsRepository.ts` | Use `AppSettings`, add `maxRecordings` storage key |
| `src/context/SettingsProvider.tsx` | Use `AppSettings` instead of `DetectionSettings` |
| `src/hooks/useRecordings.ts` | Accept `maxRecordings` parameter, enforce FIFO cap in `addRecording` |
| `src/screens/VoiceMirrorScreen.tsx` | Pass `settings.maxRecordings` to `useRecordings` |
| `app/settings.tsx` | Use `AppSettings`, add slider config for `maxRecordings`, handle "unlimited" display |
| `src/i18n/locales/en/translation.json` | Add 3 new keys |
| `src/i18n/locales/ja/translation.json` | Add 3 new keys |
| `src/hooks/__tests__/useRecordings.test.ts` | Add `maxRecordings` parameter to setup, add FIFO cap tests |

## Considerations and Trade-offs

### Enforcement at insert time vs. background cleanup

**Chosen**: Enforce at insert time in `addRecording`. This is simple, synchronous (no race conditions), and guarantees the invariant is never violated.

**Alternative**: A background cleanup that periodically scans the recordings directory. This would handle orphaned files but adds complexity and timing issues. The existing `loadRecordings` stale-entry pruning already handles the reverse case (index entries without files). Orphaned files (files without index entries) remain unaddressed by either approach but are a pre-existing concern noted in `research.md`.

### Renaming `DetectionSettings` to `AppSettings`

This rename affects all files that import the type. However, by re-exporting `DetectionSettings` as `Omit<AppSettings, 'maxRecordings'>`, the existing `useVoiceMirror` signature and its tests continue to work without changes. Files that import `DetectionSettings` for the purpose of the settings provider/repository will need to switch to `AppSettings`. The `SettingsRepository` and `SettingsProvider` already deal with the full settings object, so `AppSettings` is the correct type for them.

The alternative would be to keep `DetectionSettings` unchanged and create a separate settings type/storage for `maxRecordings`. This would mean a second `AsyncStorage` key namespace, a second context, and a second repository -- unnecessary duplication for a single numeric field that fits naturally alongside the existing settings.

### Default value of 50

A default of 50 recordings balances usability (enough history for regular use) with storage concerns (each M4A file at typical speech durations of 2-10 seconds is roughly 20-100KB, so 50 files would be about 1-5MB). The user can set it to 0 for unlimited if they prefer the old behavior.

### Slider range and step

The slider goes from 0 to 200 with a step of 5. Zero means unlimited. The step of 5 keeps the slider usable (40 discrete positions). The max of 200 is generous enough for power users without being so large that the slider becomes imprecise.

### What happens to existing users after upgrade

Existing users who upgrade will have no `maxRecordings` value in AsyncStorage. The `load()` method falls back to `DEFAULT_SETTINGS`, so they will get `maxRecordings: 50`. If they currently have more than 50 recordings, those will not be retroactively trimmed -- the cap only applies when a new recording is added. This is deliberate: silently deleting recordings a user has accumulated would be surprising. Users can manually delete old recordings or adjust the cap.

### If the currently-playing recording gets evicted

The FIFO eviction in `addRecording` could theoretically evict a recording that is currently being played from the recordings list. However, this is impossible in practice because `addRecording` is only called from `useVoiceMirror`'s `onRecordingComplete`, which fires at the end of the voice mirror's record-play cycle. During this cycle, list playback is not active (they are mutually exclusive via the suspend/resume mechanism). So there is no scenario where a list-playback recording can be evicted by a new recording being added.

### Behavior when the user lowers the cap

When a user changes `maxRecordings` from, say, 100 to 20 in the settings screen, the existing 100 recordings are not immediately trimmed. However, the next time a new recording is added, the cap is enforced and all excess recordings are deleted at once (in this example, 81 recordings would be removed). Since voice recordings in this app are transient by nature and not a precious resource, this immediate bulk deletion at the next recording is acceptable and keeps the implementation simple -- no separate "Apply now" button or retroactive trimming logic is needed.

## Todo

### 1. Rename `DetectionSettings` to `AppSettings` and add `maxRecordings`

- [x] In `src/types/settings.ts`, rename `DetectionSettings` type to `AppSettings`
- [x] Add `maxRecordings: number` field to the `AppSettings` type
- [x] Add `maxRecordings: 50` to `DEFAULT_SETTINGS`
- [x] Re-export `DetectionSettings` as `Omit<AppSettings, 'maxRecordings'>` so existing consumers remain valid

### 2. Add storage key for `maxRecordings` in the repository

- [x] In `src/repositories/SettingsRepository.ts`, add `maxRecordings: 'setting:maxRecordings'` to `STORAGE_KEYS`
- [x] Update `ISettingsRepository` interface to use `AppSettings` instead of `DetectionSettings`
- [x] Update `RealSettingsRepository` class to use `AppSettings` instead of `DetectionSettings`
- [x] Update the import from `../types/settings` to import `AppSettings`

### 3. Update `SettingsProvider` to use `AppSettings`

- [x] In `src/context/SettingsProvider.tsx`, replace `DetectionSettings` import with `AppSettings`
- [x] Update `SettingsContextValue` type to use `AppSettings` for `settings` and `updateSetting`
- [x] Update all internal references from `DetectionSettings` to `AppSettings`

### 4. Pass `maxRecordings` to `useRecordings` and enforce the FIFO cap

- [x] In `src/hooks/useRecordings.ts`, add `maxRecordings: number` parameter to the function signature
- [x] Add a `maxRecordingsRef` ref initialized from `maxRecordings` and kept in sync on each render
- [x] In `addRecording`, after prepending the new entry, check if `cap > 0 && next.length > cap`
- [x] If over cap, identify excess entries via `next.slice(cap)`
- [x] Delete each excess recording's M4A file via `repository.deleteFile()` (stripping the `file://` prefix)
- [x] Trim the list to `next.slice(0, cap)` before saving

### 5. Wire `maxRecordings` through `VoiceMirrorScreen`

- [x] In `src/screens/VoiceMirrorScreen.tsx`, read `settings` from `useSettings()`
- [x] Pass `settings.maxRecordings` as the new argument to `useRecordings`

### 6. Add slider for `maxRecordings` on the Settings screen

- [x] In `app/settings.tsx`, update the import to use `AppSettings` instead of `DetectionSettings`
- [x] Update `SliderConfig` type to use `keyof AppSettings`
- [x] Add a new entry to the `SLIDERS` array for `maxRecordings` (key, labelKey, descriptionKey, min: 0, max: 200, step: 5)
- [x] In `SettingSlider`, add special-case display logic: when `key === 'maxRecordings'` and `value === 0`, show the "unlimited" translation string instead of the numeric value

### 7. Add i18n translation keys

- [x] In `src/i18n/locales/en/translation.json`, add `settings.max_recordings_label`, `settings.max_recordings_description`, and `settings.max_recordings_unlimited`
- [x] In `src/i18n/locales/ja/translation.json`, add the same three keys with Japanese translations

### 8. Update unit tests

- [x] In `src/hooks/__tests__/useRecordings.test.ts`, update the `setup` helper to accept and pass `maxRecordings` parameter (default `0`)
- [x] Update all existing `renderHook` calls to pass `maxRecordings` to `useRecordings`
- [x] Add test: trims oldest recordings when adding exceeds `maxRecordings`
- [x] Add test: calls `repository.deleteFile` for each evicted recording's file path
- [x] Add test: does not trim when `maxRecordings` is 0 (unlimited)

### 9. Verification

- [x] Run `pnpm typecheck` and confirm no type errors
- [x] Run `pnpm lint` and confirm no lint errors
- [x] Run `pnpm test:ci` and confirm all tests pass (including the new FIFO cap tests)
