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
    const stored = await AsyncStorage.getMany(keys);

    const settings = { ...DEFAULT_SETTINGS };
    for (const [settingKey, storageKey] of Object.entries(STORAGE_KEYS)) {
      const value = stored[storageKey];
      if (value !== null && value !== undefined) {
        settings[settingKey as keyof DetectionSettings] = Number(value);
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
