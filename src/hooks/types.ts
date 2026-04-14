export type Phase = "idle" | "recording" | "playing" | "paused";

export type VoiceMirrorState = {
  phase: Phase;
  levelHistory: number[];
  currentDb: number | null;
  hasPermission: boolean;
  permissionDenied: boolean;
  recordingError: string | null;
  togglePause: () => void;
  suspendForListPlayback: () => Promise<void>;
  resumeFromListPlayback: () => Promise<void>;
};

export type RecordingCompleteCallback = (
  filePath: string,
  durationMs: number,
) => void;
