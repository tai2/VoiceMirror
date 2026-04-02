import { View, Text, StyleSheet } from 'react-native';
import type { Phase } from '../hooks/types';
import { dbToNormalized } from '../lib/audio';

const BAR_WIDTH = 4;
const BAR_GAP = 3;
const MAX_HEIGHT = 100;
const MIN_HEIGHT = 4;

const PHASE_COLOR: Record<Phase, string> = {
  idle: '#3B82F6',
  recording: '#EF4444',
  playing: '#22C55E',
  paused: '#52525B',
};

const PHASE_GLOW: Record<Phase, string> = {
  idle: 'rgba(59, 130, 246, 0.4)',
  recording: 'rgba(239, 68, 68, 0.4)',
  playing: 'rgba(34, 197, 94, 0.4)',
  paused: 'rgba(82, 82, 91, 0.2)',
};

const VOICE_THRESHOLD_COLOR = 'rgba(239, 68, 68, 0.6)';
const SILENCE_THRESHOLD_COLOR = 'rgba(251, 191, 36, 0.6)';

type Props = {
  history: number[];
  phase: Phase;
  currentDb: number | null;
  voiceThresholdDb: number;
  silenceThresholdDb: number;
};

export function AudioLevelMeter({ history, phase, currentDb, voiceThresholdDb, silenceThresholdDb }: Props) {
  const color = PHASE_COLOR[phase];
  const glowColor = PHASE_GLOW[phase];
  const isPaused = phase === 'paused';
  const showGuides = phase === 'idle' || phase === 'recording';

  const voiceNormalized = dbToNormalized(voiceThresholdDb);
  const silenceNormalized = dbToNormalized(silenceThresholdDb);

  const voiceHeight = Math.max(MIN_HEIGHT, voiceNormalized * MAX_HEIGHT);
  const silenceHeight = Math.max(MIN_HEIGHT, silenceNormalized * MAX_HEIGHT);

  const voiceTop = (MAX_HEIGHT - voiceHeight) / 2;
  const silenceTop = (MAX_HEIGHT - silenceHeight) / 2;

  return (
    <View style={styles.container}>
      <View style={[styles.glowBackground, { backgroundColor: glowColor }]} />

      {showGuides && (
        <>
          <View
            style={[
              styles.guideLine,
              { top: voiceTop, borderColor: VOICE_THRESHOLD_COLOR },
            ]}
          />
          <View
            style={[
              styles.guideLine,
              { top: silenceTop, borderColor: SILENCE_THRESHOLD_COLOR },
            ]}
          />
        </>
      )}

      {history.map((value, i) => {
        const normalizedValue = isPaused ? 0.1 : value;
        const height = Math.max(MIN_HEIGHT, normalizedValue * MAX_HEIGHT);
        const opacity = isPaused ? 0.4 : 0.5 + (value * 0.5);

        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                backgroundColor: color,
                height,
                opacity,
              },
            ]}
          />
        );
      })}

      {showGuides && currentDb !== null && (
        <View style={styles.dbLabelContainer}>
          <Text style={styles.dbLabel}>
            {Math.round(currentDb)} dB
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: MAX_HEIGHT,
    gap: BAR_GAP,
    paddingHorizontal: 16,
    position: 'relative',
  },
  glowBackground: {
    position: 'absolute',
    top: '20%',
    left: 0,
    right: 0,
    bottom: '20%',
    borderRadius: 40,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: 3,
  },
  guideLine: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    zIndex: 1,
  },
  dbLabelContainer: {
    position: 'absolute',
    top: -20,
    right: 16,
  },
  dbLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A1A1AA',
    fontVariant: ['tabular-nums'],
  },
});
