import AsyncStorage from '@react-native-async-storage/async-storage';
import { type AppSettings, DEFAULT_SETTINGS } from '../types/settings';

const STORAGE_KEYS: Record<keyof AppSettings, string> = {
  voiceThresholdDb: 'setting:voiceThresholdDb',
  voiceOnsetMs: 'setting:voiceOnsetMs',
  silenceThresholdDb: 'setting:silenceThresholdDb',
  silenceDurationMs: 'setting:silenceDurationMs',
  minRecordingMs: 'setting:minRecordingMs',
  maxRecordings: 'setting:maxRecordings',
  maxRecordingMs: 'setting:maxRecordingMs',
};

export interface ISettingsRepository {
  load(): Promise<AppSettings>;
  save<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>;
  resetAll(): Promise<void>;
}

export class RealSettingsRepository implements ISettingsRepository {
  async load(): Promise<AppSettings> {
    const keys = Object.values(STORAGE_KEYS);
    const stored = await AsyncStorage.getMany(keys);

    const settings = { ...DEFAULT_SETTINGS };
    for (const [settingKey, storageKey] of Object.entries(STORAGE_KEYS)) {
      const value = stored[storageKey];
      if (value !== null && value !== undefined) {
        settings[settingKey as keyof AppSettings] = Number(value);
      }
    }
    return settings;
  }

  async save<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS[key], String(value));
  }

  async resetAll(): Promise<void> {
    await AsyncStorage.removeMany(Object.values(STORAGE_KEYS));
  }
}
