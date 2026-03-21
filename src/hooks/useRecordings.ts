import { useState, useEffect, useRef, useCallback } from 'react';
import { decodeAudioData } from 'react-native-audio-api';
import type { AudioBuffer, AudioBufferSourceNode } from 'react-native-audio-api';
import { type Recording, loadRecordings, saveRecordings } from '../lib/recordings';
import { useAudioContext } from '../context/AudioContextProvider';

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

export function useRecordings(options: RecordingsOptions): RecordingsState {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playState, setPlayState] = useState<PlayState>(null);
  const ctx = useAudioContext();
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isDecodingRef = useRef(false);

  useEffect(() => {
    loadRecordings().then(setRecordings);
    return () => {
      if (sourceRef.current) {
        sourceRef.current.onEnded = null;
        sourceRef.current.stop();
        sourceRef.current = null;
      }
    };
  }, []);

  const stopCurrentPlayer = useCallback((notify: boolean) => {
    if (sourceRef.current) {
      sourceRef.current.onEnded = null;
      sourceRef.current.stop();
      sourceRef.current = null;
      setPlayState(null);
    }
    if (notify) void options.onDidStop();
  }, [options.onDidStop]);

  const addRecording = useCallback((filePath: string, durationMs: number) => {
    const entry: Recording = {
      id: String(Date.now()),
      filePath: 'file://' + filePath,
      recordedAt: new Date().toISOString(),
      durationMs,
    };
    setRecordings(prev => {
      const next = [entry, ...prev];
      saveRecordings(next);
      return next;
    });
  }, []);

  const togglePlay = useCallback(async (recording: Recording) => {
    if (!ctx) return;

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
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await decodeAudioData(recording.filePath, ctx.sampleRate);
    } catch (e) {
      console.error('[useRecordings] decodeAudioData failed:', e);
      isDecodingRef.current = false;
      setPlayState(null);
      await options.onDidStop();
      return;
    }
    isDecodingRef.current = false;

    const source = ctx.createBufferSource();
    sourceRef.current = source;
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onEnded = () => {
      sourceRef.current = null;
      setPlayState(null);
      void options.onDidStop();
    };
    source.start(0);
  }, [playState, ctx, stopCurrentPlayer, options]);

  return { recordings, playState, addRecording, togglePlay };
}
