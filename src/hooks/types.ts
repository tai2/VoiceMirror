export type Phase = 'idle' | 'recording' | 'playing' | 'paused';

export type VoiceMirrorState = {
  phase: Phase;
  levelHistory: number[];
  hasPermission: boolean;
  permissionDenied: boolean;
  recordingError: string | null;
  togglePause: () => void;
};

export type RecordingCompleteCallback = (filePath: string, durationMs: number) => void;
