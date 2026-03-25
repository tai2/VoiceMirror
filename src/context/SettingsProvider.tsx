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
      void repository.save(key, value);
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
