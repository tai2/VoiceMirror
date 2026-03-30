import { View, StyleSheet } from 'react-native';
import type { Phase } from '../hooks/types';

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

type Props = {
  history: number[];
  phase: Phase;
};

export function AudioLevelMeter({ history, phase }: Props) {
  const color = PHASE_COLOR[phase];
  const glowColor = PHASE_GLOW[phase];
  const isPaused = phase === 'paused';

  return (
    <View style={styles.container}>
      <View style={[styles.glowBackground, { backgroundColor: glowColor }]} />
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
});
