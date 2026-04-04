import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Path, Line } from 'react-native-svg';
import type { Phase } from '../hooks/types';
import { dbToNormalized } from '../lib/audio';
import { LEVEL_HISTORY_SIZE } from '../constants/audio';

export const BAR_WIDTH = 4;
const BAR_GAP = 3;
const MAX_HEIGHT = 200;
const MIN_HEIGHT = 8;
const CONTENT_WIDTH =
  LEVEL_HISTORY_SIZE * BAR_WIDTH + (LEVEL_HISTORY_SIZE - 1) * BAR_GAP;

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

  const voiceY = MAX_HEIGHT - voiceHeight;
  const silenceY = MAX_HEIGHT - silenceHeight;

  return (
    <View style={styles.container}>
      <Svg
        width="100%"
        height={MAX_HEIGHT}
        viewBox={`0 0 ${CONTENT_WIDTH} ${MAX_HEIGHT}`}
      >
        <Path
          d={`M40,${MAX_HEIGHT * 0.4} h${CONTENT_WIDTH - 80} a40,40 0 0 1 40,40 v${MAX_HEIGHT * 0.6 - 40} h-${CONTENT_WIDTH} v-${MAX_HEIGHT * 0.6 - 40} a40,40 0 0 1 40,-40 z`}
          fill={glowColor}
        />

        {showGuides && (
          <>
            <Line
              x1={0}
              y1={voiceY}
              x2={CONTENT_WIDTH}
              y2={voiceY}
              stroke={VOICE_THRESHOLD_COLOR}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <Line
              x1={0}
              y1={silenceY}
              x2={CONTENT_WIDTH}
              y2={silenceY}
              stroke={SILENCE_THRESHOLD_COLOR}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
          </>
        )}

        {history.map((value, i) => {
          const normalizedValue = isPaused ? 0.1 : value;
          const height = Math.max(MIN_HEIGHT, normalizedValue * MAX_HEIGHT);
          const opacity = isPaused ? 0.4 : 0.5 + value * 0.5;
          const x = i * (BAR_WIDTH + BAR_GAP);
          const y = MAX_HEIGHT - height;

          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={height}
              rx={3}
              fill={color}
              opacity={opacity}
            />
          );
        })}
      </Svg>

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
    height: MAX_HEIGHT,
    paddingHorizontal: 16,
    position: 'relative',
    alignSelf: 'stretch',
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
