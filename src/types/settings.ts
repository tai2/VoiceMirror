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
