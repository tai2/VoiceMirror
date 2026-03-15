import { useEffect, useRef, useState } from 'react';
import {
  useAudioRecorder,
  useAudioPlayer,
  useAudioRecorderState,
  useAudioPlayerStatus,
  requestRecordingPermissionsAsync,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio';
import {
  VOICE_THRESHOLD_DB,
  SILENCE_THRESHOLD_DB,
  VOICE_ONSET_MS,
  SILENCE_DURATION_MS,
  MIN_RECORDING_MS,
  LEVEL_HISTORY_SIZE,
  DB_FLOOR,
  DB_CEIL,
} from '../constants/audio';
import type { Phase, VoiceMirrorState } from './types';

export function useVoiceMirror(): VoiceMirrorState {
  const [phase, setPhase] = useState<Phase>('idle');
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [levelHistory, setLevelHistory] = useState<number[]>(
    () => new Array(LEVEL_HISTORY_SIZE).fill(0),
  );

  const voiceStartTimeRef = useRef<number | null>(null);
  const silenceStartTimeRef = useRef<number | null>(null);
  const voiceStartMsRef = useRef<number>(0);

  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const player = useAudioPlayer(null);

  const recorderState = useAudioRecorderState(recorder, 100);
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    (async () => {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setPermissionDenied(true);
        return;
      }
      setHasPermission(true);
      await startMonitoring();
    })();
  }, []);

  useEffect(() => {
    if (!recorderState.isRecording || recorderState.metering == null) return;

    const db = recorderState.metering;
    const durationMs = recorderState.durationMillis;

    const normalized = Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
    setLevelHistory(prev => [...prev.slice(1), normalized]);

    const now = Date.now();

    if (phase === 'idle') {
      if (db > VOICE_THRESHOLD_DB) {
        if (voiceStartTimeRef.current === null) {
          voiceStartTimeRef.current = now;
          voiceStartMsRef.current = durationMs;
        } else if (now - voiceStartTimeRef.current >= VOICE_ONSET_MS) {
          silenceStartTimeRef.current = null;
          setPhase('recording');
        }
      } else {
        voiceStartTimeRef.current = null;
      }
    } else if (phase === 'recording') {
      const recordingMs = durationMs - voiceStartMsRef.current;

      if (db < SILENCE_THRESHOLD_DB && recordingMs >= MIN_RECORDING_MS) {
        if (silenceStartTimeRef.current === null) {
          silenceStartTimeRef.current = now;
        } else if (now - silenceStartTimeRef.current >= SILENCE_DURATION_MS) {
          silenceStartTimeRef.current = null;
          setPhase('playing');
          void stopAndPlay();
        }
      } else if (db >= SILENCE_THRESHOLD_DB) {
        silenceStartTimeRef.current = null;
      }
    }
  }, [recorderState, phase]);

  useEffect(() => {
    if (playerStatus.didJustFinish) {
      void startMonitoring();
    }
  }, [playerStatus.didJustFinish]);

  async function setRecordingMode() {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });
  }

  async function setPlaybackMode() {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    });
  }

  async function startMonitoring() {
    await setRecordingMode();
    voiceStartTimeRef.current = null;
    silenceStartTimeRef.current = null;
    voiceStartMsRef.current = 0;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase('idle');
  }

  async function stopAndPlay() {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      await startMonitoring();
      return;
    }
    await setPlaybackMode();
    player.replace(uri);
    await player.seekTo(voiceStartMsRef.current / 1000);
    player.play();
  }

  return { phase, levelHistory, hasPermission, permissionDenied };
}
