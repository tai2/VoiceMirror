export type Phase = 'idle' | 'recording' | 'playing' | 'paused';

export type VoiceMirrorState = {
  phase: Phase;
  levelHistory: number[];
  hasPermission: boolean;
  permissionDenied: boolean;
  togglePause: () => void;
};
