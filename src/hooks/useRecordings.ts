import { useState, useEffect, useRef, useCallback } from "react";
import type {
  AudioContext,
  AudioBufferSourceNode,
} from "react-native-audio-api";
import { LEVEL_HISTORY_SIZE } from "../constants/audio";
import { usePlaybackLevelHistory } from "./usePlaybackLevelHistory";
import type { Recording } from "../lib/recordings";
import type { IRecordingsRepository } from "../repositories/RecordingsRepository";
import type { IAudioDecoderService } from "../services/AudioDecoderService";
import { captureException, addBreadcrumb } from "../lib/sentryHelpers";

export type PlayState = { recordingId: string; isPlaying: boolean } | null;

type RecordingsOptions = {
  onWillPlay: () => Promise<void>;
  onDidStop: () => Promise<void>;
};

export type RecordingsState = {
  recordings: Recording[];
  playState: PlayState;
  levelHistory: number[];
  addRecording: (filePath: string, durationMs: number) => void;
  deleteRecording: (id: string) => void;
  togglePlay: (recording: Recording) => void;
};

export function useRecordings(
  options: RecordingsOptions,
  audioContext: AudioContext | null,
  repository: IRecordingsRepository,
  decoderService: IAudioDecoderService,
  maxRecordings: number,
): RecordingsState {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playState, setPlayState] = useState<PlayState>(null);
  const [levelHistory, setLevelHistory] = useState<number[]>(() =>
    new Array(LEVEL_HISTORY_SIZE).fill(0),
  );
  const { startPlaybackLevels, stopPlaybackLevels } = usePlaybackLevelHistory();
  const recordingsRef = useRef<Recording[]>(recordings);
  recordingsRef.current = recordings;
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;
  const maxRecordingsRef = useRef(maxRecordings);
  maxRecordingsRef.current = maxRecordings;
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isDecodingRef = useRef(false);

  useEffect(() => {
    repository.load().then(setRecordings);
    return () => {
      if (sourceRef.current) {
        sourceRef.current.onEnded = null;
        sourceRef.current.stop();
        sourceRef.current = null;
      }
      stopPlaybackLevels();
    };
  }, [repository, stopPlaybackLevels]);

  const stopCurrentPlayer = useCallback(
    (notify: boolean) => {
      if (sourceRef.current) {
        sourceRef.current.onEnded = null;
        sourceRef.current.stop();
        sourceRef.current = null;
        setPlayState(null);
        stopPlaybackLevels();
        setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0));
      }
      if (notify) void options.onDidStop();
    },
    [options, stopPlaybackLevels],
  );

  const addRecording = useCallback((filePath: string, durationMs: number) => {
    const entry: Recording = {
      id: String(Date.now()),
      filePath: "file://" + filePath,
      recordedAt: new Date().toISOString(),
      durationMs,
    };
    let next = [entry, ...recordingsRef.current];

    const cap = maxRecordingsRef.current;
    if (cap > 0 && next.length > cap) {
      const excess = next.slice(cap);
      for (const r of excess) {
        repositoryRef.current.deleteFile(r.filePath.replace("file://", ""));
      }
      next = next.slice(0, cap);
    }

    setRecordings(next);
    repositoryRef.current.save(next);
  }, []);

  const deleteRecording = useCallback(
    (id: string) => {
      const recording = recordingsRef.current.find((r) => r.id === id);
      if (!recording) return;

      if (playState?.recordingId === id) {
        stopCurrentPlayer(true);
      }

      repository.deleteFile(recording.filePath.replace("file://", ""));

      const next = recordingsRef.current.filter((r) => r.id !== id);
      setRecordings(next);
      repositoryRef.current.save(next);
    },
    [playState, repository, stopCurrentPlayer],
  );

  const togglePlay = useCallback(
    async (recording: Recording) => {
      if (!audioContext) return;

      if (playState?.recordingId === recording.id && playState.isPlaying) {
        stopCurrentPlayer(true);
        return;
      }

      if (isDecodingRef.current) return;

      const wasAlreadyPlaying = sourceRef.current !== null;
      stopCurrentPlayer(false);

      if (!wasAlreadyPlaying) {
        await options.onWillPlay();
      }

      setPlayState({ recordingId: recording.id, isPlaying: true });

      isDecodingRef.current = true;
      let audioBuffer;
      try {
        audioBuffer = await decoderService.decodeAudioData(
          recording.filePath,
          audioContext.sampleRate,
        );
      } catch (e) {
        console.error("[useRecordings] decodeAudioData failed:", e);
        captureException(e, {
          operation: "AudioDecoder.decodeAudioData",
          filePath: recording.filePath,
          recordingId: recording.id,
          sampleRate: audioContext.sampleRate,
        });
        isDecodingRef.current = false;
        setPlayState(null);
        await options.onDidStop();
        return;
      }
      isDecodingRef.current = false;

      const source = audioContext.createBufferSource();
      sourceRef.current = source;
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onEnded = () => {
        sourceRef.current = null;
        setPlayState(null);
        stopPlaybackLevels();
        setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0));
        void options.onDidStop();
      };
      source.start(0);
      addBreadcrumb("recordings", "List playback started", {
        recordingId: recording.id,
        durationMs: recording.durationMs,
      });
      startPlaybackLevels(audioBuffer, 0, setLevelHistory);
    },
    [
      playState,
      audioContext,
      decoderService,
      stopCurrentPlayer,
      options,
      startPlaybackLevels,
      stopPlaybackLevels,
    ],
  );

  return {
    recordings,
    playState,
    levelHistory,
    addRecording,
    deleteRecording,
    togglePlay,
  };
}
