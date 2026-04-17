import { useEffect, useRef, useState } from "react";
import type { AudioContext } from "react-native-audio-api";
import { LEVEL_HISTORY_SIZE } from "../constants/audio";
import { computeLevel } from "../lib/audio";
import { usePlaybackLevelHistory } from "./usePlaybackLevelHistory";
import type {
  Phase,
  VoiceMirrorState,
  RecordingCompleteCallback,
} from "./types";
import type {
  IAudioRecordingService,
  IAudioRecorder,
} from "../services/AudioRecordingService";
import type { IAudioEncoderService } from "../services/AudioEncoderService";
import type { IRecordingsRepository } from "../repositories/RecordingsRepository";
import type { DetectionSettings } from "../types/settings";
import {
  captureException,
  captureMessage,
  addBreadcrumb,
} from "../lib/sentryHelpers";

const BUFFER_LENGTH = 4096;
const CHANNEL_COUNT = 1;
const MAX_IDLE_BUFFER_SECS = 30;
const SAFETY_MARGIN_MS = 100;
const GAP_TOLERANCE_MS = 200;

function findPreRollStartFrame(
  chunks: Float32Array[],
  totalFrames: number,
  bufferedFrames: number,
  sampleRate: number,
  silenceThresholdDb: number,
): number {
  const bufferStartFrame = totalFrames - bufferedFrames;
  const safetyMarginFrames = Math.round((SAFETY_MARGIN_MS / 1000) * sampleRate);
  const gapToleranceFrames = Math.round((GAP_TOLERANCE_MS / 1000) * sampleRate);

  let framesToEnd = 0;
  let gapFrames = 0;
  let lastOnsetFrame: number | null = null;

  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const { db } = computeLevel(chunk, 0, chunk.length);
    framesToEnd += chunk.length;

    if (db < silenceThresholdDb) {
      if (lastOnsetFrame === null) {
        lastOnsetFrame = totalFrames - framesToEnd + chunk.length;
      }
      gapFrames += chunk.length;

      if (gapFrames > gapToleranceFrames) {
        const preRollFrame = lastOnsetFrame - safetyMarginFrames;
        return Math.max(bufferStartFrame, preRollFrame);
      }
    } else {
      gapFrames = 0;
      lastOnsetFrame = null;
    }
  }

  if (lastOnsetFrame !== null && gapFrames > gapToleranceFrames) {
    const preRollFrame = lastOnsetFrame - safetyMarginFrames;
    return Math.max(bufferStartFrame, preRollFrame);
  }

  return bufferStartFrame;
}

export function useVoiceMirror(
  onRecordingComplete: RecordingCompleteCallback,
  audioContext: AudioContext | null,
  recordingService: IAudioRecordingService,
  encoderService: IAudioEncoderService,
  repository: IRecordingsRepository,
  settings: DetectionSettings,
): VoiceMirrorState {
  const [phase, setPhase] = useState<Phase>("idle");
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [levelHistory, setLevelHistory] = useState<number[]>(() =>
    new Array(LEVEL_HISTORY_SIZE).fill(0),
  );
  const [currentDb, setCurrentDb] = useState<number | null>(null);

  const { startPlaybackLevels, stopPlaybackLevels } = usePlaybackLevelHistory();

  const audioContextRef = useRef(audioContext);
  const audioRecorderRef = useRef<IAudioRecorder | null>(null);
  const playerNodeRef = useRef<ReturnType<
    NonNullable<typeof audioContext>["createBufferSource"]
  > | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const voiceStartTimeRef = useRef<number | null>(null);
  const silenceStartTimeRef = useRef<number | null>(null);

  const chunksRef = useRef<Float32Array[]>([]);
  const totalFramesRef = useRef<number>(0);
  const bufferedFramesRef = useRef<number>(0);
  const voiceStartFrameRef = useRef<number>(0);

  const pendingFilePathRef = useRef<string | null>(null);
  const encoderFailedRef = useRef(false);
  const wasUserPausedRef = useRef(false);
  const startMonitoringRef = useRef<() => Promise<void>>(async () => {});
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!audioContext) return;
    audioContextRef.current = audioContext;

    (async () => {
      const status = await recordingService.requestRecordingPermissions();
      if (status !== "Granted") {
        setPermissionDenied(true);
        addBreadcrumb(
          "voicemirror",
          "Microphone permission denied",
          undefined,
          "warning",
        );
        return;
      }
      setHasPermission(true);
      addBreadcrumb("voicemirror", "Microphone permission granted");
      recordingService.setAudioSessionOptions({
        iosCategory: "playAndRecord",
        iosOptions: ["defaultToSpeaker"],
      });
      audioRecorderRef.current = recordingService.createRecorder();
      await startMonitoringRef.current();
    })();

    return () => {
      audioRecorderRef.current?.clearOnAudioReady();
      void audioRecorderRef.current?.stop();
      stopPlaybackLevels();
    };
  }, [audioContext, recordingService, stopPlaybackLevels]);

  function beginEncoding() {
    const context = audioContextRef.current!;
    const filePath = repository.newFilePath();
    encoderFailedRef.current = false;

    try {
      encoderService.startEncoding(filePath, context.sampleRate);
      pendingFilePathRef.current = filePath;
    } catch (e) {
      console.error("[AudioEncoder] startEncoding failed:", e);
      captureException(e, {
        operation: "AudioEncoder.startEncoding",
        filePath,
        sampleRate: context.sampleRate,
      });
      return;
    }

    const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
    let framesCounted = 0;
    for (const chunk of chunksRef.current) {
      const chunkStart = bufferStartFrame + framesCounted;
      const chunkEnd = chunkStart + chunk.length;
      framesCounted += chunk.length;

      if (chunkEnd <= voiceStartFrameRef.current) continue;

      const skipInChunk = Math.max(0, voiceStartFrameRef.current - chunkStart);
      const slice = skipInChunk > 0 ? chunk.slice(skipInChunk) : chunk;
      try {
        encoderService.encodeChunk(slice);
      } catch (e) {
        console.error("[AudioEncoder] encodeChunk failed:", e);
        captureException(e, {
          operation: "AudioEncoder.encodeChunk",
          phase: "catchup",
          filePath,
        });
        encoderFailedRef.current = true;
      }
    }
  }

  function tickStateMachine(
    db: number,
    totalFrames: number,
    sampleRate: number,
  ) {
    const now = Date.now();
    const s = settingsRef.current;

    if (phaseRef.current === "idle") {
      if (db > s.voiceThresholdDb) {
        if (voiceStartTimeRef.current === null) {
          voiceStartTimeRef.current = now;
          voiceStartFrameRef.current = findPreRollStartFrame(
            chunksRef.current,
            totalFramesRef.current,
            bufferedFramesRef.current,
            sampleRate,
            s.silenceThresholdDb,
          );
        } else if (now - voiceStartTimeRef.current >= s.voiceOnsetMs) {
          silenceStartTimeRef.current = null;
          phaseRef.current = "recording";
          setPhase("recording");
          addBreadcrumb("voicemirror", "Recording started", {
            voiceStartFrame: voiceStartFrameRef.current,
          });
          beginEncoding();
        }
      } else {
        voiceStartTimeRef.current = null;
      }
    } else if (phaseRef.current === "recording") {
      const speechMs =
        ((totalFrames - voiceStartFrameRef.current) / sampleRate) * 1000;

      if (s.maxRecordingMs > 0 && speechMs >= s.maxRecordingMs) {
        silenceStartTimeRef.current = null;
        phaseRef.current = "playing";
        setPhase("playing");
        addBreadcrumb("voicemirror", "Recording stopped, playing back");
        void stopAndPlay();
        return;
      }

      if (db < s.silenceThresholdDb && speechMs >= s.minRecordingMs) {
        if (silenceStartTimeRef.current === null) {
          silenceStartTimeRef.current = now;
        } else if (now - silenceStartTimeRef.current >= s.silenceDurationMs) {
          silenceStartTimeRef.current = null;
          phaseRef.current = "playing";
          setPhase("playing");
          addBreadcrumb("voicemirror", "Recording stopped, playing back");
          void stopAndPlay();
        }
      } else if (db >= s.silenceThresholdDb) {
        silenceStartTimeRef.current = null;
      }
    }
  }

  async function startMonitoring() {
    const context = audioContextRef.current!;
    const recorder = audioRecorderRef.current!;

    chunksRef.current = [];
    totalFramesRef.current = 0;
    bufferedFramesRef.current = 0;
    voiceStartTimeRef.current = null;
    silenceStartTimeRef.current = null;
    voiceStartFrameRef.current = 0;
    phaseRef.current = "idle";
    pendingFilePathRef.current = null;
    encoderFailedRef.current = false;
    setRecordingError(null);

    await recordingService.setAudioSessionActivity(true);
    await context.resume();
    recorder.start();
    addBreadcrumb("voicemirror", "Monitoring started", {
      sampleRate: context.sampleRate,
    });

    recorder.onAudioReady(
      {
        sampleRate: context.sampleRate,
        bufferLength: BUFFER_LENGTH,
        channelCount: CHANNEL_COUNT,
      },
      ({ chunk, numFrames }) => {
        chunksRef.current.push(chunk);
        totalFramesRef.current += numFrames;
        bufferedFramesRef.current += numFrames;

        if (phaseRef.current === "idle" && voiceStartTimeRef.current === null) {
          const maxFrames = MAX_IDLE_BUFFER_SECS * context.sampleRate;
          while (
            chunksRef.current.length > 1 &&
            bufferedFramesRef.current - chunksRef.current[0].length >= maxFrames
          ) {
            bufferedFramesRef.current -= chunksRef.current[0].length;
            chunksRef.current.shift();
          }
        }

        if (
          phaseRef.current === "recording" &&
          pendingFilePathRef.current &&
          !encoderFailedRef.current
        ) {
          try {
            encoderService.encodeChunk(chunk);
          } catch (e) {
            console.error("[AudioEncoder] encodeChunk failed:", e);
            captureException(e, {
              operation: "AudioEncoder.encodeChunk",
              phase: "streaming",
            });
            encoderFailedRef.current = true;
          }
        }

        const { normalized, db } = computeLevel(chunk, 0, numFrames);
        setLevelHistory((prev) => [...prev.slice(1), normalized]);
        setCurrentDb(db);
        tickStateMachine(db, totalFramesRef.current, context.sampleRate);
      },
    );

    setPhase("idle");
  }

  startMonitoringRef.current = startMonitoring;

  async function stopAndPlay() {
    const context = audioContextRef.current!;
    const recorder = audioRecorderRef.current!;

    setCurrentDb(null);
    recorder.clearOnAudioReady();
    recorder.stop();

    if (chunksRef.current.length === 0) {
      await startMonitoring();
      return;
    }

    const filePath = pendingFilePathRef.current;
    pendingFilePathRef.current = null;

    let durationMs = 0;
    if (filePath && !encoderFailedRef.current) {
      try {
        durationMs = await Promise.race([
          encoderService.stopEncoding(),
          new Promise<number>((_, reject) =>
            setTimeout(() => reject(new Error("stopEncoding timed out")), 5000),
          ),
        ]);
        if (durationMs === 0) {
          console.error(
            `[AudioEncoder] stopEncoding returned 0 for ${filePath}`,
          );
          captureMessage("AudioEncoder stopEncoding returned duration 0", {
            operation: "AudioEncoder.stopEncoding",
            filePath,
            sampleRate: context.sampleRate,
          });
        }
      } catch (e) {
        console.error(`[AudioEncoder] stopEncoding threw for ${filePath}:`, e);
        captureException(e, {
          operation: "AudioEncoder.stopEncoding",
          filePath,
          sampleRate: context.sampleRate,
        });
      }
    } else if (filePath && encoderFailedRef.current) {
      console.error(
        `[AudioEncoder] skipped stopEncoding due to prior chunk error: ${filePath}`,
      );
      captureMessage(
        "AudioEncoder skipped stopEncoding due to prior chunk error",
        {
          operation: "AudioEncoder.stopEncoding",
          filePath,
          reason: "prior_chunk_error",
        },
        "warning",
      );
    }

    if (filePath && durationMs === 0) {
      repository.deleteFile(filePath);
      setRecordingError("recording_failed");
    }

    if (filePath && durationMs > 0) {
      onRecordingComplete(filePath, durationMs);
    }

    // Snapshot chunks and compute actual size to avoid any mismatch between
    // bufferedFramesRef and real chunk data (native copyToChannel has no bounds
    // checking and will segfault on overflow).
    const chunks = chunksRef.current;
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    if (totalLength === 0) {
      await startMonitoring();
      return;
    }
    const merged = new Float32Array(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
      merged.set(chunk, pos);
      pos += chunk.length;
    }
    const audioBuffer = context.createBuffer(
      1,
      totalLength,
      context.sampleRate,
    );
    audioBuffer.copyToChannel(merged, 0, 0);

    const bufferStartFrame = totalFramesRef.current - totalLength;
    const voiceStartSecs = Math.max(
      0,
      (voiceStartFrameRef.current - bufferStartFrame) / context.sampleRate,
    );

    const playerNode = context.createBufferSource();
    playerNodeRef.current = playerNode;
    playerNode.buffer = audioBuffer;
    playerNode.connect(context.destination);

    const playbackDurationSecs = audioBuffer.duration - voiceStartSecs;
    let ended = false;
    const onPlaybackEnd = () => {
      if (ended) return;
      ended = true;
      playerNodeRef.current = null;
      stopPlaybackLevels();
      void startMonitoring();
    };
    playerNode.onEnded = onPlaybackEnd;
    // Fallback: if onEnded doesn't fire, force transition after expected duration
    setTimeout(onPlaybackEnd, (playbackDurationSecs + 1) * 1000);

    playerNode.start(0, voiceStartSecs);
    startPlaybackLevels(audioBuffer, voiceStartSecs, setLevelHistory);
  }

  async function pauseMonitoring() {
    addBreadcrumb("voicemirror", "Monitoring paused");
    if (playerNodeRef.current) {
      playerNodeRef.current.onEnded = null;
      playerNodeRef.current.stop();
      playerNodeRef.current = null;
    }
    stopPlaybackLevels();
    const recorder = audioRecorderRef.current!;
    recorder.clearOnAudioReady();
    recorder.stop();

    // Clean up in-progress encoding if paused during recording
    if (pendingFilePathRef.current) {
      const filePath = pendingFilePathRef.current;
      pendingFilePathRef.current = null;
      if (!encoderFailedRef.current) {
        try {
          await encoderService.stopEncoding();
        } catch (e) {
          console.error(
            "[AudioEncoder] stopEncoding failed during pause cleanup:",
            e,
          );
          captureException(e, {
            operation: "AudioEncoder.stopEncoding",
            phase: "pause_cleanup",
            filePath,
          });
        }
      }
      repository.deleteFile(filePath);
    }

    await audioContextRef.current?.suspend();
    await recordingService.setAudioSessionActivity(false);
    phaseRef.current = "paused";
    setPhase("paused");
    setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0));
    setCurrentDb(null);
  }

  async function resumeMonitoring() {
    addBreadcrumb("voicemirror", "Monitoring resumed");
    await startMonitoring();
  }

  function togglePause() {
    if (phaseRef.current === "paused") {
      void resumeMonitoring();
    } else {
      void pauseMonitoring();
    }
  }

  async function suspendForListPlayback() {
    wasUserPausedRef.current = phaseRef.current === "paused";

    if (playerNodeRef.current) {
      playerNodeRef.current.onEnded = null;
      playerNodeRef.current.stop();
      playerNodeRef.current = null;
    }
    stopPlaybackLevels();

    if (phaseRef.current !== "paused") {
      audioRecorderRef.current?.clearOnAudioReady();
      audioRecorderRef.current?.stop();
      phaseRef.current = "idle";
      setPhase("idle");
    } else {
      await recordingService.setAudioSessionActivity(true);
    }

    await audioContextRef.current?.resume();
  }

  async function resumeFromListPlayback() {
    if (wasUserPausedRef.current) {
      phaseRef.current = "paused";
      setPhase("paused");
      await audioContextRef.current?.suspend();
      await recordingService.setAudioSessionActivity(false);
    } else {
      await startMonitoring();
    }
  }

  return {
    phase,
    levelHistory,
    currentDb,
    hasPermission,
    permissionDenied,
    recordingError,
    togglePause,
    suspendForListPlayback,
    resumeFromListPlayback,
  };
}
