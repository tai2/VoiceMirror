# Recording Timeout -- Implementation Plan

## Goal

Add a configurable maximum recording duration so that a recording ends automatically after a time limit, even if the user is still speaking or background noise keeps the audio level above the silence threshold. Without this, recordings can grow indefinitely, consuming unbounded memory (~10 MB/min of `Float32Array` buffers) and disk space. The timeout is user-configurable from the Settings screen and persisted via AsyncStorage, following the same patterns as all existing settings.

## Architecture / Approach

### Where the timeout is enforced

The enforcement point is `tickStateMachine` inside `src/hooks/useVoiceMirror.ts`. When in the `recording` phase, the variable `speechMs` is already computed on every tick:

```typescript
const speechMs = ((totalFrames - voiceStartFrameRef.current) / sampleRate) * 1000;
```

This represents elapsed recording time in milliseconds based on actual audio frames processed -- it is frame-accurate and already available. A new timeout check compares `speechMs` against the `maxRecordingMs` setting. When the threshold is exceeded, the same `stopAndPlay()` exit path used by silence detection is triggered.

The timeout check is placed BEFORE the silence detection logic so that timeout takes priority. This means that even if the audio is still loud (no silence detected), the recording will end.

### Settings integration

The new `maxRecordingMs` field is added to `AppSettings` in `src/types/settings.ts`. Since `DetectionSettings` is defined as `Omit<AppSettings, 'maxRecordings'>`, the new field is automatically included in `DetectionSettings` without any type change. This means `useVoiceMirror` (which accepts `DetectionSettings`) will have access to it via `settingsRef.current`.

The value `0` means "no timeout" (unlimited recording duration), following the same convention as `maxRecordings` where `0` means "unlimited". The settings screen already has precedent for displaying "Unlimited" when a value is 0.

### Data flow

```
Settings screen
  -> SettingsProvider (persists to AsyncStorage)
  -> useSettings() in VoiceMirrorScreen
  -> settings passed to useVoiceMirror as DetectionSettings
  -> settingsRef.current updated on each render
  -> tickStateMachine reads settingsRef.current.maxRecordingMs
  -> if speechMs >= maxRecordingMs (and maxRecordingMs > 0):
       transition to 'playing', call stopAndPlay()
```

### What happens when timeout fires

When the timeout fires mid-speech, `stopAndPlay()` is called -- the same function used when silence ends a recording. This function:

1. Stops the recorder and clears the audio callback.
2. Finalizes encoding via `encoderService.stopEncoding()`.
3. Calls `onRecordingComplete(filePath, durationMs)` to save the recording.
4. Builds an `AudioBuffer` from accumulated chunks and plays it back.
5. When playback ends, calls `startMonitoring()` to restart the cycle.

After playback, the app resumes listening. If the user is still speaking, their continued voice will be picked up in the next monitoring cycle, potentially triggering a new recording immediately. This creates a natural "chunking" behavior for long recordings.

### Display in settings screen

The slider value is stored internally in milliseconds but displayed to the user in seconds for readability. The special case of `0` displays "Unlimited" (same pattern as `maxRecordings`). Rather than continuing to add key-specific conditionals in `SettingSlider`, this plan generalizes the display logic by having each `SliderConfig` optionally specify a `displayValue` function.

## Code Changes

### 1. Add `maxRecordingMs` to `AppSettings`

**File: `src/types/settings.ts`**

```typescript
export type AppSettings = {
  voiceThresholdDb: number;
  voiceOnsetMs: number;
  silenceThresholdDb: number;
  silenceDurationMs: number;
  minRecordingMs: number;
  maxRecordings: number;
  maxRecordingMs: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  voiceThresholdDb: -35,
  voiceOnsetMs: 250,
  silenceThresholdDb: -45,
  silenceDurationMs: 1500,
  minRecordingMs: 500,
  maxRecordings: 50,
  maxRecordingMs: 60000,
};

export type DetectionSettings = Omit<AppSettings, 'maxRecordings'>;
```

No change needed to `DetectionSettings` -- since it is `Omit<AppSettings, 'maxRecordings'>`, the new `maxRecordingMs` field is automatically included.

### 2. Add storage key for `maxRecordingMs`

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
  maxRecordingMs: 'setting:maxRecordingMs',
};
```

No other changes needed in this file -- the `STORAGE_KEYS` type is `Record<keyof AppSettings, string>`, so TypeScript will require the new key to be present. The `load()` and `save()` methods are already generic over `AppSettings` keys.

### 3. Add timeout check in `tickStateMachine`

**File: `src/hooks/useVoiceMirror.ts`**

Inside the `recording` branch of `tickStateMachine`, add a timeout check BEFORE the existing silence detection logic:

```typescript
} else if (phaseRef.current === 'recording') {
  const speechMs = ((totalFrames - voiceStartFrameRef.current) / sampleRate) * 1000;

  // Timeout: force-stop recording if maxRecordingMs is exceeded
  if (s.maxRecordingMs > 0 && speechMs >= s.maxRecordingMs) {
    silenceStartTimeRef.current = null;
    phaseRef.current = 'playing';
    setPhase('playing');
    void stopAndPlay();
    return;
  }

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
```

Key points:
- The check `s.maxRecordingMs > 0` skips the timeout when the value is 0 (unlimited).
- `silenceStartTimeRef.current = null` resets the silence timer, consistent with the silence-triggered path.
- The `return` statement prevents falling through to the silence detection logic (unnecessary since phase has changed, but explicit for clarity).
- This uses the same `stopAndPlay()` exit path as silence detection -- no new code path is needed.

### 4. Add slider for `maxRecordingMs` on the Settings screen

**File: `app/settings.tsx`**

First, generalize the special-case display logic. Currently `SettingSlider` has a hardcoded check for `maxRecordings`. With a second "unlimited when 0" setting, this approach doesn't scale. Instead, add an optional `displayValue` function to `SliderConfig`:

```typescript
type SliderConfig = {
  key: keyof AppSettings;
  labelKey: string;
  descriptionKey: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  displayValue?: (value: number, t: (key: string) => string) => string;
};
```

Update the `maxRecordings` entry and add the new `maxRecordingMs` entry:

```typescript
const SLIDERS: SliderConfig[] = [
  // ...existing 5 entries (voiceThresholdDb through minRecordingMs) unchanged...
  {
    key: 'maxRecordings',
    labelKey: 'settings.max_recordings_label',
    descriptionKey: 'settings.max_recordings_description',
    min: 0,
    max: 200,
    step: 5,
    unit: '',
    displayValue: (v, t) => v === 0 ? t('settings.unlimited') : String(v),
  },
  {
    key: 'maxRecordingMs',
    labelKey: 'settings.max_recording_duration_label',
    descriptionKey: 'settings.max_recording_duration_description',
    min: 0,
    max: 300000,
    step: 5000,
    unit: 's',
    displayValue: (v, t) => v === 0 ? t('settings.unlimited') : `${v / 1000} s`,
  },
];
```

Update `SettingSlider` to use the `displayValue` function:

```typescript
function SettingSlider({ config }: { config: SliderConfig }) {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const value = settings[config.key];

  const displayValue = config.displayValue
    ? config.displayValue(value, t)
    : `${value} ${config.unit}`;

  return (
    <View style={styles.sliderCard}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{t(config.labelKey)}</Text>
        <Text style={styles.sliderValue}>{displayValue}</Text>
      </View>
      <Text style={styles.sliderDescription}>{t(config.descriptionKey)}</Text>
      <Slider
        minimumValue={config.min}
        maximumValue={config.max}
        step={config.step}
        value={value}
        onValueChange={(v: number) => updateSetting(config.key, v)}
        minimumTrackTintColor="#4A9EFF"
        maximumTrackTintColor="#DDD"
      />
      <View style={styles.sliderRange}>
        <Text style={styles.rangeLabel}>
          {config.min} {config.unit}
        </Text>
        <Text style={styles.defaultLabel}>
          {t("settings.default_prefix")} {DEFAULT_SETTINGS[config.key]} {config.unit}
        </Text>
        <Text style={styles.rangeLabel}>
          {config.max} {config.unit}
        </Text>
      </View>
    </View>
  );
}
```

Note: The range labels at the bottom of the slider still show raw values with units. For `maxRecordingMs`, this means the min/max/default labels will show `0 s`, `300000 s`, and `60000 s`. These raw-millisecond labels at the bottom are not ideal. To address this, the `displayValue` approach could be extended to the range labels as well, or the range labels could also use a `formatRangeValue` function. However, the simpler approach is to keep the range labels using the same `displayValue` function for consistency. Here is a cleaner approach -- add a `formatRangeValue` helper to the config:

Actually, the cleanest approach is to keep the slider config simple and handle the range display within `displayValue` logic. The range labels are secondary information, and showing `0 s` / `300000 s` would be confusing. Instead, we should display the min/max/default in the same human-readable format. We can achieve this by adding a `formatValue` function to `SliderConfig` that converts the raw stored value to a display string (without the "Unlimited" special case), and use `displayValue` only for the current value display:

```typescript
type SliderConfig = {
  key: keyof AppSettings;
  labelKey: string;
  descriptionKey: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  displayValue?: (value: number, t: (key: string) => string) => string;
  formatValue?: (value: number) => string;
};
```

For `maxRecordingMs`:
```typescript
{
  key: 'maxRecordingMs',
  labelKey: 'settings.max_recording_duration_label',
  descriptionKey: 'settings.max_recording_duration_description',
  min: 0,
  max: 300000,
  step: 5000,
  unit: 's',
  displayValue: (v, t) => v === 0 ? t('settings.unlimited') : `${v / 1000} s`,
  formatValue: (v) => `${v / 1000}`,
},
```

And update the range labels to use `formatValue` when available:

```typescript
<View style={styles.sliderRange}>
  <Text style={styles.rangeLabel}>
    {config.formatValue ? config.formatValue(config.min) : config.min} {config.unit}
  </Text>
  <Text style={styles.defaultLabel}>
    {t("settings.default_prefix")} {config.formatValue ? config.formatValue(DEFAULT_SETTINGS[config.key]) : DEFAULT_SETTINGS[config.key]} {config.unit}
  </Text>
  <Text style={styles.rangeLabel}>
    {config.formatValue ? config.formatValue(config.max) : config.max} {config.unit}
  </Text>
</View>
```

This way, the range labels show `0 s`, `60 s` (default), `300 s` -- human-readable seconds.

### 5. Add i18n translation keys

**File: `src/i18n/locales/en/translation.json`**

Add the following keys (the existing `settings.max_recordings_unlimited` key is consolidated into a shared `settings.unlimited` key):

```json
{
  "settings.unlimited": "Unlimited",
  "settings.max_recording_duration_label": "Max Recording Duration",
  "settings.max_recording_duration_description": "Maximum duration of a single recording. When the limit is reached, the recording ends automatically and playback begins. Set to 0 for unlimited."
}
```

Also rename `settings.max_recordings_unlimited` to `settings.unlimited` since both `maxRecordings` and `maxRecordingMs` will use it. Update the existing reference in the `maxRecordings` slider's `displayValue` function accordingly.

**File: `src/i18n/locales/ja/translation.json`**

```json
{
  "settings.unlimited": "無制限",
  "settings.max_recording_duration_label": "最大録音時間",
  "settings.max_recording_duration_description": "1回の録音の最大時間。上限に達すると録音が自動的に終了し再生が始まります。0で無制限。"
}
```

Also rename `settings.max_recordings_unlimited` to `settings.unlimited` in this file.

### 6. Update unit tests

**File: `src/hooks/__tests__/useVoiceMirror.test.ts`**

The existing `setup()` function uses `DEFAULT_SETTINGS` which will now include `maxRecordingMs: 60000`. Since the default timeout is 60 seconds and no existing test generates 60 seconds of audio data, all existing tests pass without modification.

Add new test cases in a new describe block:

```typescript
describe('useVoiceMirror -- recording timeout', () => {
  it('transitions to playing when speechMs exceeds maxRecordingMs', async () => {
    const onRecordingComplete = jest.fn();
    const recordingService = new StubAudioRecordingService();
    const encoderService = new StubAudioEncoderService();
    const repository = new StubRecordingsRepository();
    const audioContext = makeStubAudioContext();

    const shortTimeoutSettings = {
      ...DEFAULT_SETTINGS,
      maxRecordingMs: 2000, // 2 second timeout
    };

    const { result } = renderHook(() =>
      useVoiceMirror(
        onRecordingComplete, audioContext, recordingService,
        encoderService, repository, shortTimeoutSettings,
      ),
    );

    await waitFor(() => expect(result.current.hasPermission).toBe(true));

    act(() => {
      // Trigger voice onset
      simulateVoiceOnset(recordingService);

      // Feed loud chunks past the 2-second timeout without any silence
      const chunkMs = 100;
      const chunksNeeded = Math.ceil(2000 / chunkMs) + 2;
      for (let i = 0; i < chunksNeeded; i++) {
        jest.advanceTimersByTime(chunkMs);
        recordingService.recorder.simulateChunk(makeLoudChunk(chunkMs));
      }
    });

    await waitFor(() => expect(result.current.phase).toBe('playing'));
  });

  it('does not timeout when maxRecordingMs is 0 (unlimited)', async () => {
    const onRecordingComplete = jest.fn();
    const recordingService = new StubAudioRecordingService();
    const encoderService = new StubAudioEncoderService();
    const repository = new StubRecordingsRepository();
    const audioContext = makeStubAudioContext();

    const unlimitedSettings = {
      ...DEFAULT_SETTINGS,
      maxRecordingMs: 0,
    };

    const { result } = renderHook(() =>
      useVoiceMirror(
        onRecordingComplete, audioContext, recordingService,
        encoderService, repository, unlimitedSettings,
      ),
    );

    await waitFor(() => expect(result.current.hasPermission).toBe(true));

    act(() => {
      simulateVoiceOnset(recordingService);

      // Feed 5 seconds of loud audio -- should stay in recording
      const chunkMs = 100;
      const chunksNeeded = Math.ceil(5000 / chunkMs);
      for (let i = 0; i < chunksNeeded; i++) {
        jest.advanceTimersByTime(chunkMs);
        recordingService.recorder.simulateChunk(makeLoudChunk(chunkMs));
      }
    });

    expect(result.current.phase).toBe('recording');
  });

  it('calls onRecordingComplete when timeout triggers with valid encoding', async () => {
    const onRecordingComplete = jest.fn();
    const recordingService = new StubAudioRecordingService();
    const encoderService = new StubAudioEncoderService();
    const repository = new StubRecordingsRepository();
    const audioContext = makeStubAudioContext();
    encoderService.stopEncoding.mockResolvedValue(2000);

    const shortTimeoutSettings = {
      ...DEFAULT_SETTINGS,
      maxRecordingMs: 2000,
    };

    const { result } = renderHook(() =>
      useVoiceMirror(
        onRecordingComplete, audioContext, recordingService,
        encoderService, repository, shortTimeoutSettings,
      ),
    );

    await waitFor(() => expect(result.current.hasPermission).toBe(true));

    act(() => {
      simulateVoiceOnset(recordingService);
      const chunkMs = 100;
      const chunksNeeded = Math.ceil(2000 / chunkMs) + 2;
      for (let i = 0; i < chunksNeeded; i++) {
        jest.advanceTimersByTime(chunkMs);
        recordingService.recorder.simulateChunk(makeLoudChunk(chunkMs));
      }
    });

    await waitFor(() => expect(result.current.phase).toBe('playing'));
    expect(onRecordingComplete).toHaveBeenCalledWith(
      expect.stringContaining('.m4a'),
      2000,
    );
  });
});
```

## Files That Need Modification

| File | Change |
|------|--------|
| `src/types/settings.ts` | Add `maxRecordingMs: number` to `AppSettings`, add `maxRecordingMs: 60000` to `DEFAULT_SETTINGS` |
| `src/repositories/SettingsRepository.ts` | Add `maxRecordingMs: 'setting:maxRecordingMs'` to `STORAGE_KEYS` |
| `src/hooks/useVoiceMirror.ts` | Add timeout check in `tickStateMachine` before silence detection |
| `app/settings.tsx` | Add `displayValue` and `formatValue` to `SliderConfig` type, refactor `SettingSlider` display logic, add `maxRecordingMs` slider config, update `maxRecordings` slider to use shared `settings.unlimited` key |
| `src/i18n/locales/en/translation.json` | Add `settings.unlimited`, `settings.max_recording_duration_label`, `settings.max_recording_duration_description`; remove `settings.max_recordings_unlimited` |
| `src/i18n/locales/ja/translation.json` | Add `settings.unlimited`, `settings.max_recording_duration_label`, `settings.max_recording_duration_description`; remove `settings.max_recordings_unlimited` |
| `src/hooks/__tests__/useVoiceMirror.test.ts` | Add test cases for timeout trigger, unlimited (0) behavior, and onRecordingComplete callback on timeout |

## Considerations and Trade-offs

### Frame-based timing vs. wall-clock timing

The timeout uses frame-based timing (`speechMs` computed from `totalFrames` and `sampleRate`) rather than wall-clock timing (`Date.now()`). This is the right choice because it accurately reflects how much audio has actually been recorded. Under audio callback jitter or CPU load, wall-clock time and frame time can diverge. Since the purpose of the timeout is to cap recorded audio duration and memory growth, frame-based timing is the correct measure.

### Timeout fires before silence detection

The timeout check is placed before the silence detection block. This means that if `speechMs` exceeds `maxRecordingMs` on the same tick that silence would also end the recording, the timeout path wins. In practice this makes no functional difference -- both paths call `stopAndPlay()` -- but the ordering makes the intent clear: timeout is a hard cap that takes priority.

### Default value of 60 seconds

A default of 60000 ms (60 seconds) balances typical voice mirror usage (short speech practice snippets of 5-30 seconds) with the need to cap memory growth. At ~10 MB/min, 60 seconds means a maximum of ~10 MB of in-memory buffers per recording. Users who need longer recordings can increase the timeout or set it to 0 for unlimited.

### Slider range and step

The slider goes from 0 to 300000 ms (0 to 5 minutes) with a step of 5000 ms (5 seconds). This gives 60 discrete positions plus the "0 = unlimited" position. The maximum of 5 minutes (~50 MB of in-memory buffers) is generous enough for most use cases without risking out-of-memory issues on constrained mobile devices. The step of 5 seconds keeps the slider usable.

### Displaying milliseconds as seconds

The stored value is in milliseconds (consistent with all other duration settings in the app: `voiceOnsetMs`, `silenceDurationMs`, `minRecordingMs`). However, displaying "60000 ms" to the user would be poor UX -- "60 s" is far more readable for values in this range. The `displayValue` and `formatValue` functions handle this conversion at the presentation layer only.

### Consolidating the "Unlimited" translation key

Currently `settings.max_recordings_unlimited` is used only for the `maxRecordings` slider. With a second "unlimited when 0" setting, it makes sense to consolidate into a single `settings.unlimited` key. This is a minor breaking change to the i18n keys (the old key is removed), but since no external system references these keys, the impact is limited to the two translation files.

### Interaction with `minRecordingMs`

The timeout value should logically be greater than `minRecordingMs` (default 500 ms). If `maxRecordingMs` is set lower than `minRecordingMs`, the behavior is still correct: the timeout fires based on `speechMs` independently of `minRecordingMs` (which only gates silence-based ending). However, it would mean silence can never end the recording early -- only the timeout would work. The slider range (minimum 0, step 5000 = first non-zero value is 5000 ms) makes this interaction safe since 5000 >> 500 (the default `minRecordingMs`).

### What happens to existing users after upgrade

Existing users who upgrade will have no `maxRecordingMs` value in AsyncStorage. The `load()` method falls back to `DEFAULT_SETTINGS`, so they will get `maxRecordingMs: 60000` (60 seconds). This means their recordings will now be capped at 60 seconds by default. If a user was relying on indefinite recording, they can set the value to 0 for unlimited. This is an intentional behavior change -- the whole point of this feature is to prevent unbounded recordings.

### Chunking behavior for long speech

When the timeout fires during active speech, the user's continued voice after playback will be picked up by the next monitoring cycle, potentially triggering a new recording immediately. This creates natural "chunks" of long speech. This is acceptable behavior for a voice mirror app where the purpose is short-term feedback, not long-form recording.

## Todo

### 1. Add `maxRecordingMs` to settings type and defaults

- [x] Add `maxRecordingMs: number` field to `AppSettings` in `src/types/settings.ts`
- [x] Add `maxRecordingMs: 60000` to `DEFAULT_SETTINGS` in `src/types/settings.ts`
- [x] Verify `DetectionSettings` (`Omit<AppSettings, 'maxRecordings'>`) automatically includes `maxRecordingMs` without changes

### 2. Add storage key for persistence

- [x] Add `maxRecordingMs: 'setting:maxRecordingMs'` to `STORAGE_KEYS` in `src/repositories/SettingsRepository.ts`

### 3. Add timeout check in `tickStateMachine`

- [x] In `src/hooks/useVoiceMirror.ts`, locate the `recording` branch of `tickStateMachine`
- [x] Add timeout check BEFORE the existing silence detection logic: if `s.maxRecordingMs > 0 && speechMs >= s.maxRecordingMs`, reset `silenceStartTimeRef`, set phase to `'playing'`, and call `stopAndPlay()`
- [x] Ensure the timeout path returns early to skip silence detection on the same tick

### 4. Update i18n translation keys

- [x] In `src/i18n/locales/en/translation.json`: add `settings.unlimited`, `settings.max_recording_duration_label`, `settings.max_recording_duration_description`
- [x] In `src/i18n/locales/en/translation.json`: remove `settings.max_recordings_unlimited` (replaced by `settings.unlimited`)
- [x] In `src/i18n/locales/ja/translation.json`: add `settings.unlimited`, `settings.max_recording_duration_label`, `settings.max_recording_duration_description`
- [x] In `src/i18n/locales/ja/translation.json`: remove `settings.max_recordings_unlimited` (replaced by `settings.unlimited`)

### 5. Update Settings screen slider configuration and display logic

- [x] In `app/settings.tsx`, add optional `displayValue` field `(value: number, t: (key: string) => string) => string` to `SliderConfig` type
- [x] Add optional `formatValue` field `(value: number) => string` to `SliderConfig` type
- [x] Update `maxRecordings` slider config to use `displayValue` with shared `settings.unlimited` key instead of hardcoded `settings.max_recordings_unlimited`
- [x] Add new `maxRecordingMs` slider config entry with `displayValue` (show "Unlimited" for 0, `${v / 1000} s` otherwise) and `formatValue` (convert ms to seconds for range labels)
- [x] Refactor `SettingSlider` component to use `config.displayValue` for the current value display instead of hardcoded `maxRecordings` check
- [x] Update range labels in `SettingSlider` to use `config.formatValue` when available for min/max/default display
- [x] Remove any existing hardcoded `maxRecordings`-specific display logic from `SettingSlider`

### 6. Add unit tests for recording timeout

- [x] In `src/hooks/__tests__/useVoiceMirror.test.ts`, add a `describe('useVoiceMirror -- recording timeout')` block
- [x] Add test: transitions to `'playing'` when `speechMs` exceeds `maxRecordingMs` (use `maxRecordingMs: 2000`, feed loud audio chunks past 2 seconds)
- [x] Add test: does NOT timeout when `maxRecordingMs` is 0 (unlimited) -- feed 5 seconds of loud audio and verify phase stays `'recording'`
- [x] Add test: `onRecordingComplete` is called with correct file path and duration when timeout triggers

### 7. Verification

- [x] Run `pnpm typecheck` and confirm no type errors
- [x] Run `pnpm lint` and confirm no lint errors
- [x] Run `pnpm test:ci` and confirm all tests pass (existing + new)
