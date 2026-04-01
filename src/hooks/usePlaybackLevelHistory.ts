import { useRef, useCallback } from 'react';
import type { AudioBuffer } from 'react-native-audio-api';
import { LEVEL_HISTORY_SIZE } from '../constants/audio';
import { computeNormalizedLevel } from '../lib/audio';

const PLAYBACK_TICK_MS = 93;
const FRAMES_PER_TICK = 4096;

type LevelHistorySetter = (updater: (prev: number[]) => number[]) => void;

export function usePlaybackLevelHistory() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPlaybackLevels = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPlaybackLevels = useCallback(
    (audioBuffer: AudioBuffer, startOffsetSec: number, setLevelHistory: LevelHistorySetter) => {
      stopPlaybackLevels();

      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const totalFrames = audioBuffer.length;
      const startFrame = Math.floor(startOffsetSec * sampleRate);
      const playbackStartTime = Date.now();

      setLevelHistory(() => new Array(LEVEL_HISTORY_SIZE).fill(0));

      timerRef.current = setInterval(() => {
        const elapsedMs = Date.now() - playbackStartTime;
        const currentFrame = startFrame + Math.floor((elapsedMs / 1000) * sampleRate);

        if (currentFrame >= totalFrames) {
          stopPlaybackLevels();
          return;
        }

        const framesToRead = Math.min(FRAMES_PER_TICK, totalFrames - currentFrame);
        const normalized = computeNormalizedLevel(channelData, currentFrame, framesToRead);
        setLevelHistory(prev => [...prev.slice(1), normalized]);
      }, PLAYBACK_TICK_MS);
    },
    [stopPlaybackLevels],
  );

  return { startPlaybackLevels, stopPlaybackLevels };
}
