import { useState, useEffect, useRef, useCallback } from 'react';
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import { type Recording, loadRecordings, saveRecordings } from '../lib/recordings';

export type PlayState = { recordingId: string; isPlaying: boolean } | null;

export type RecordingsState = {
  recordings: Recording[];
  playState: PlayState;
  addRecording: (filePath: string, durationMs: number) => void;
  togglePlay: (recording: Recording) => void;
};

export function useRecordings(): RecordingsState {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playState, setPlayState] = useState<PlayState>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    loadRecordings().then(setRecordings);
    return () => {
      playerRef.current?.remove();
      playerRef.current = null;
    };
  }, []);

  const stopCurrentPlayer = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.remove();
      playerRef.current = null;
      setPlayState(null);
    }
  }, []);

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

  const togglePlay = useCallback((recording: Recording) => {
    if (playState?.recordingId === recording.id && playState.isPlaying) {
      stopCurrentPlayer();
      return;
    }

    stopCurrentPlayer();

    const player = createAudioPlayer({ uri: recording.filePath });
    playerRef.current = player;
    setPlayState({ recordingId: recording.id, isPlaying: true });

    player.addListener('playbackStatusUpdate', status => {
      if (status.didJustFinish) {
        player.remove();
        playerRef.current = null;
        setPlayState(null);
      }
    });

    player.play();
  }, [playState, stopCurrentPlayer]);

  return { recordings, playState, addRecording, togglePlay };
}
