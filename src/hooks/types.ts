export type Phase = 'idle' | 'recording' | 'playing';

export type VoiceMirrorState = {
  phase: Phase;
  levelHistory: number[];
  hasPermission: boolean;
  permissionDenied: boolean;
};
