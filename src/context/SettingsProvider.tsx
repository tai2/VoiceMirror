import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { type AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import type { ISettingsRepository } from '../repositories/SettingsRepository';
import { captureException } from '../lib/sentryHelpers';

type SettingsContextValue = {
  settings: AppSettings;
  loaded: boolean;
  updateSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void;
  resetSettings: () => void;
};

const SettingsCtx = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({
  children,
  repository,
}: {
  children: React.ReactNode;
  repository: ISettingsRepository;
}) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    repository.load().then((s) => {
      setSettings(s);
      setLoaded(true);
    }).catch((e) => {
      captureException(e, {
        operation: 'SettingsRepository.load',
      });
      setLoaded(true);
    });
  }, [repository]);

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      repository.save(key, value).catch((e) => {
        captureException(e, {
          operation: 'SettingsRepository.save',
          key,
          value,
        });
      });
    },
    [repository],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    repository.resetAll().catch((e) => {
      captureException(e, {
        operation: 'SettingsRepository.resetAll',
      });
    });
  }, [repository]);

  return (
    <SettingsCtx.Provider value={{ settings, loaded, updateSetting, resetSettings }}>
      {children}
    </SettingsCtx.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
