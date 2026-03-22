import { useState, useEffect, useRef, useCallback } from 'react';
import type { AudioContext, AudioBufferSourceNode } from 'react-native-audio-api';
import type { Recording } from '../lib/recordings';
import type { IRecordingsRepository } from '../repositories/RecordingsRepository';
import type { IAudioDecoderService } from '../services/AudioDecoderService';

export type PlayState = { recordingId: string; isPlaying: boolean } | null;

type RecordingsOptions = {
  onWillPlay: () => Promise<void>;
  onDidStop: () => Promise<void>;
};

export type RecordingsState = {
  recordings: Recording[];
  playState: PlayState;
  addRecording: (filePath: string, durationMs: number) => void;
  togglePlay: (recording: Recording) => void;
};

export function useRecordings(
  options: RecordingsOptions,
  audioContext: AudioContext | null,
  repository: IRecordingsRepository,
  decoderService: IAudioDecoderService,
): RecordingsState {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playState, setPlayState] = useState<PlayState>(null);
  const recordingsRef = useRef<Recording[]>(recordings);
  recordingsRef.current = recordings;
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;
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
    };
  }, [repository]);

  const stopCurrentPlayer = useCallback((notify: boolean) => {
    if (sourceRef.current) {
      sourceRef.current.onEnded = null;
      sourceRef.current.stop();
      sourceRef.current = null;
      setPlayState(null);
    }
    if (notify) void options.onDidStop();
  }, [options]);

  const addRecording = useCallback((filePath: string, durationMs: number) => {
    const entry: Recording = {
      id: String(Date.now()),
      filePath: 'file://' + filePath,
      recordedAt: new Date().toISOString(),
      durationMs,
    };
    const next = [entry, ...recordingsRef.current];
    setRecordings(next);
    repositoryRef.current.save(next);
  }, []);

  const togglePlay = useCallback(async (recording: Recording) => {
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
      audioBuffer = await decoderService.decodeAudioData(recording.filePath, audioContext.sampleRate);
    } catch (e) {
      console.error('[useRecordings] decodeAudioData failed:', e);
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
      void options.onDidStop();
    };
    source.start(0);
  }, [playState, audioContext, decoderService, stopCurrentPlayer, options]);

  return { recordings, playState, addRecording, togglePlay };
}
