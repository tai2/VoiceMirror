import { View, StyleSheet } from 'react-native';
import type { Phase } from '../hooks/types';

const BAR_WIDTH = 4;
const BAR_GAP = 2;
const MAX_HEIGHT = 80;

const PHASE_COLOR: Record<Phase, string> = {
  idle: '#4A9EFF',
  recording: '#FF4444',
  playing: '#44BB44',
  paused: '#AAAAAA',
};

type Props = {
  history: number[];
  phase: Phase;
};

export function AudioLevelMeter({ history, phase }: Props) {
  const color = PHASE_COLOR[phase];

  return (
    <View style={styles.container}>
      {history.map((value, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            { backgroundColor: color, height: Math.max(2, value * MAX_HEIGHT) },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MAX_HEIGHT,
    gap: BAR_GAP,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: 2,
  },
});
