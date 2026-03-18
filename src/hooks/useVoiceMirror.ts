import { useEffect, useRef, useState } from 'react';
import { AudioContext, AudioRecorder, AudioManager } from 'react-native-audio-api';
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

const SAMPLE_RATE = 44100;
const BUFFER_LENGTH = 4096;
const CHANNEL_COUNT = 1;
const MAX_IDLE_BUFFER_SECS = 30;

export function useVoiceMirror(): VoiceMirrorState {
  const [phase, setPhase] = useState<Phase>('idle');
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [levelHistory, setLevelHistory] = useState<number[]>(
    () => new Array(LEVEL_HISTORY_SIZE).fill(0),
  );

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const playerNodeRef = useRef<ReturnType<AudioContext['createBufferSource']> | null>(null);

  const phaseRef = useRef<Phase>('idle');
  const voiceStartTimeRef = useRef<number | null>(null);
  const silenceStartTimeRef = useRef<number | null>(null);

  const chunksRef = useRef<Float32Array[]>([]);
  const totalFramesRef = useRef<number>(0);
  const bufferedFramesRef = useRef<number>(0);
  const voiceStartFrameRef = useRef<number>(0);

  useEffect(() => {
    (async () => {
      const status = await AudioManager.requestRecordingPermissions();
      if (status !== 'Granted') {
        setPermissionDenied(true);
        return;
      }
      setHasPermission(true);
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosOptions: ['defaultToSpeaker'],
      });
      audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioRecorderRef.current = new AudioRecorder();
      await startMonitoring();
    })();

    return () => {
      audioRecorderRef.current?.clearOnAudioReady();
      void audioRecorderRef.current?.stop();
      void audioContextRef.current?.close();
    };
  }, []);

  function tickStateMachine(db: number, totalFrames: number, sampleRate: number) {
    const now = Date.now();

    if (phaseRef.current === 'idle') {
      if (db > VOICE_THRESHOLD_DB) {
        if (voiceStartTimeRef.current === null) {
          voiceStartTimeRef.current = now;
          voiceStartFrameRef.current = totalFrames;
        } else if (now - voiceStartTimeRef.current >= VOICE_ONSET_MS) {
          silenceStartTimeRef.current = null;
          phaseRef.current = 'recording';
          setPhase('recording');
        }
      } else {
        voiceStartTimeRef.current = null;
      }
    } else if (phaseRef.current === 'recording') {
      const speechMs = ((totalFrames - voiceStartFrameRef.current) / sampleRate) * 1000;

      if (db < SILENCE_THRESHOLD_DB && speechMs >= MIN_RECORDING_MS) {
        if (silenceStartTimeRef.current === null) {
          silenceStartTimeRef.current = now;
        } else if (now - silenceStartTimeRef.current >= SILENCE_DURATION_MS) {
          silenceStartTimeRef.current = null;
          phaseRef.current = 'playing';
          setPhase('playing');
          void stopAndPlay();
        }
      } else if (db >= SILENCE_THRESHOLD_DB) {
        silenceStartTimeRef.current = null;
      }
    }
  }

  async function startMonitoring() {
    const ctx = audioContextRef.current!;
    const recorder = audioRecorderRef.current!;

    chunksRef.current = [];
    totalFramesRef.current = 0;
    bufferedFramesRef.current = 0;
    voiceStartTimeRef.current = null;
    silenceStartTimeRef.current = null;
    voiceStartFrameRef.current = 0;
    phaseRef.current = 'idle';

    await AudioManager.setAudioSessionActivity(true);
    await recorder.start();

    recorder.onAudioReady(
      { sampleRate: ctx.sampleRate, bufferLength: BUFFER_LENGTH, channelCount: CHANNEL_COUNT },
      ({ buffer, numFrames }) => {
        const chunk = new Float32Array(numFrames);
        buffer.copyFromChannel(chunk, 0);

        chunksRef.current.push(chunk);
        totalFramesRef.current += numFrames;
        bufferedFramesRef.current += numFrames;

        if (phaseRef.current === 'idle' && voiceStartTimeRef.current === null) {
          const maxFrames = MAX_IDLE_BUFFER_SECS * ctx.sampleRate;
          while (
            chunksRef.current.length > 1 &&
            bufferedFramesRef.current - chunksRef.current[0].length >= maxFrames
          ) {
            bufferedFramesRef.current -= chunksRef.current[0].length;
            chunksRef.current.shift();
          }
        }

        let sumSq = 0;
        for (let i = 0; i < numFrames; i++) sumSq += chunk[i] * chunk[i];
        const rms = Math.sqrt(sumSq / numFrames);
        const db = 20 * Math.log10(Math.max(rms, 1e-10));

        const normalized = Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
        setLevelHistory(prev => [...prev.slice(1), normalized]);

        tickStateMachine(db, totalFramesRef.current, ctx.sampleRate);
      },
    );

    setPhase('idle');
  }

  async function stopAndPlay() {
    const ctx = audioContextRef.current!;
    const recorder = audioRecorderRef.current!;

    recorder.clearOnAudioReady();
    await recorder.stop();

    if (chunksRef.current.length === 0) {
      await startMonitoring();
      return;
    }

    const bufferedFrames = bufferedFramesRef.current;
    const audioBuffer = ctx.createBuffer(1, bufferedFrames, ctx.sampleRate);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      audioBuffer.copyToChannel(chunk, 0, offset);
      offset += chunk.length;
    }

    const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
    const voiceStartSecs = (voiceStartFrameRef.current - bufferStartFrame) / ctx.sampleRate;

    const playerNode = ctx.createBufferSource();
    playerNodeRef.current = playerNode;
    playerNode.buffer = audioBuffer;
    playerNode.connect(ctx.destination);
    playerNode.onEnded = () => {
      playerNodeRef.current = null;
      void startMonitoring();
    };
    playerNode.start(0, voiceStartSecs);
  }

  async function pauseMonitoring() {
    if (playerNodeRef.current) {
      playerNodeRef.current.onEnded = null;
      playerNodeRef.current.stop();
      playerNodeRef.current = null;
    }
    const recorder = audioRecorderRef.current!;
    recorder.clearOnAudioReady();
    await recorder.stop();
    await AudioManager.setAudioSessionActivity(false);
    phaseRef.current = 'paused';
    setPhase('paused');
    setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0));
  }

  async function resumeMonitoring() {
    await startMonitoring();
  }

  function togglePause() {
    if (phaseRef.current === 'paused') {
      void resumeMonitoring();
    } else {
      void pauseMonitoring();
    }
  }

  return { phase, levelHistory, hasPermission, permissionDenied, togglePause };
}
