import { useEffect, useRef, useState } from 'react';
import { AudioRecorder, AudioManager } from 'react-native-audio-api';
import { File } from 'expo-file-system';
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
import type { Phase, VoiceMirrorState, RecordingCompleteCallback } from './types';
import AudioEncoder from 'audio-encoder';
import { newFilePath } from '../lib/recordings';
import { useAudioContext } from '../context/AudioContextProvider';

const BUFFER_LENGTH = 4096;
const CHANNEL_COUNT = 1;
const MAX_IDLE_BUFFER_SECS = 30;

export function useVoiceMirror(onRecordingComplete: RecordingCompleteCallback): VoiceMirrorState {
  const [phase, setPhase] = useState<Phase>('idle');
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [levelHistory, setLevelHistory] = useState<number[]>(
    () => new Array(LEVEL_HISTORY_SIZE).fill(0),
  );

  const ctx = useAudioContext();

  const audioContextRef = useRef(ctx);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const playerNodeRef = useRef<ReturnType<NonNullable<typeof ctx>['createBufferSource']> | null>(null);

  const phaseRef = useRef<Phase>('idle');
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

  useEffect(() => {
    if (!ctx) return;
    audioContextRef.current = ctx;

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
      audioRecorderRef.current = new AudioRecorder();
      await startMonitoringRef.current();
    })();

    return () => {
      audioRecorderRef.current?.clearOnAudioReady();
      void audioRecorderRef.current?.stop();
    };
  }, [ctx]);

  function beginEncoding() {
    const context = audioContextRef.current!;
    const filePath = newFilePath();
    encoderFailedRef.current = false;

    try {
      AudioEncoder.startEncoding(filePath, context.sampleRate);
      pendingFilePathRef.current = filePath;
    } catch (e) {
      console.error('[AudioEncoder] startEncoding failed:', e);
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
        AudioEncoder.encodeChunk(slice);
      } catch (e) {
        console.error('[AudioEncoder] encodeChunk failed:', e);
        encoderFailedRef.current = true;
      }
    }
  }

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
          beginEncoding();
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
    const context = audioContextRef.current!;
    const recorder = audioRecorderRef.current!;

    chunksRef.current = [];
    totalFramesRef.current = 0;
    bufferedFramesRef.current = 0;
    voiceStartTimeRef.current = null;
    silenceStartTimeRef.current = null;
    voiceStartFrameRef.current = 0;
    phaseRef.current = 'idle';
    pendingFilePathRef.current = null;
    encoderFailedRef.current = false;
    setRecordingError(null);

    await AudioManager.setAudioSessionActivity(true);
    await recorder.start();

    recorder.onAudioReady(
      { sampleRate: context.sampleRate, bufferLength: BUFFER_LENGTH, channelCount: CHANNEL_COUNT },
      ({ buffer, numFrames }) => {
        const chunk = new Float32Array(numFrames);
        buffer.copyFromChannel(chunk, 0);

        chunksRef.current.push(chunk);
        totalFramesRef.current += numFrames;
        bufferedFramesRef.current += numFrames;

        if (phaseRef.current === 'idle' && voiceStartTimeRef.current === null) {
          const maxFrames = MAX_IDLE_BUFFER_SECS * context.sampleRate;
          while (
            chunksRef.current.length > 1 &&
            bufferedFramesRef.current - chunksRef.current[0].length >= maxFrames
          ) {
            bufferedFramesRef.current -= chunksRef.current[0].length;
            chunksRef.current.shift();
          }
        }

        if (phaseRef.current === 'recording' && pendingFilePathRef.current && !encoderFailedRef.current) {
          try {
            AudioEncoder.encodeChunk(chunk);
          } catch (e) {
            console.error('[AudioEncoder] encodeChunk failed:', e);
            encoderFailedRef.current = true;
          }
        }

        let sumSq = 0;
        for (let i = 0; i < numFrames; i++) sumSq += chunk[i] * chunk[i];
        const rms = Math.sqrt(sumSq / numFrames);
        const db = 20 * Math.log10(Math.max(rms, 1e-10));

        const normalized = Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
        setLevelHistory(prev => [...prev.slice(1), normalized]);

        tickStateMachine(db, totalFramesRef.current, context.sampleRate);
      },
    );

    setPhase('idle');
  }

  startMonitoringRef.current = startMonitoring;

  async function stopAndPlay() {
    const context = audioContextRef.current!;
    const recorder = audioRecorderRef.current!;

    recorder.clearOnAudioReady();
    await recorder.stop();

    if (chunksRef.current.length === 0) {
      await startMonitoring();
      return;
    }

    const filePath = pendingFilePathRef.current;
    pendingFilePathRef.current = null;

    let durationMs = 0;
    if (filePath && !encoderFailedRef.current) {
      try {
        durationMs = await AudioEncoder.stopEncoding();
        if (durationMs === 0) {
          console.error(`[AudioEncoder] stopEncoding returned 0 for ${filePath}`);
        }
      } catch (e) {
        console.error(`[AudioEncoder] stopEncoding threw for ${filePath}:`, e);
      }
    } else if (filePath && encoderFailedRef.current) {
      console.error(`[AudioEncoder] skipped stopEncoding due to prior chunk error: ${filePath}`);
    }

    if (filePath && durationMs === 0) {
      new File('file://' + filePath).delete();
      setRecordingError('Recording failed to save.');
    }

    if (filePath && durationMs > 0) {
      onRecordingComplete(filePath, durationMs);
    }

    const bufferedFrames = bufferedFramesRef.current;
    const audioBuffer = context.createBuffer(1, bufferedFrames, context.sampleRate);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      audioBuffer.copyToChannel(chunk, 0, offset);
      offset += chunk.length;
    }

    const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
    const voiceStartSecs = (voiceStartFrameRef.current - bufferStartFrame) / context.sampleRate;

    const playerNode = context.createBufferSource();
    playerNodeRef.current = playerNode;
    playerNode.buffer = audioBuffer;
    playerNode.connect(context.destination);
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

  async function suspendForListPlayback() {
    wasUserPausedRef.current = phaseRef.current === 'paused';

    if (playerNodeRef.current) {
      playerNodeRef.current.onEnded = null;
      playerNodeRef.current.stop();
      playerNodeRef.current = null;
    }

    if (phaseRef.current !== 'paused') {
      audioRecorderRef.current?.clearOnAudioReady();
      await audioRecorderRef.current?.stop();
      phaseRef.current = 'idle';
      setPhase('idle');
    } else {
      await AudioManager.setAudioSessionActivity(true);
    }

    await audioContextRef.current?.resume();
  }

  async function resumeFromListPlayback() {
    if (wasUserPausedRef.current) {
      phaseRef.current = 'paused';
      setPhase('paused');
      // Suspend the context before deactivating the session so the native render
      // thread is cleanly stopped. Without this, the context JS state stays
      // 'running' while the render thread is killed by session deactivation,
      // and a subsequent ctx.resume() sees 'running' and becomes a no-op,
      // leaving the render thread dead on the next list play.
      await audioContextRef.current?.suspend();
      await AudioManager.setAudioSessionActivity(false);
    } else {
      await startMonitoring();
    }
  }

  return {
    phase,
    levelHistory,
    hasPermission,
    permissionDenied,
    recordingError,
    togglePause,
    suspendForListPlayback,
    resumeFromListPlayback,
  };
}
