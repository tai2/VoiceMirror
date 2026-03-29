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
