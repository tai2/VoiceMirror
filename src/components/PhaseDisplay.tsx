import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import type { Phase } from '../hooks/types';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Listening…',
  recording: 'Recording',
  playing: 'Playing back',
  paused: 'Paused',
};

const PHASE_COLOR: Record<Phase, string> = {
  idle: '#4A9EFF',
  recording: '#FF4444',
  playing: '#44BB44',
  paused: '#AAAAAA',
};

type Props = { phase: Phase };

export function PhaseDisplay({ phase }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 600, useNativeDriver: true }),
      ]),
    );
    if (phase === 'idle') {
      animation.start();
    } else {
      animation.stop();
      pulse.setValue(1);
    }
    return () => animation.stop();
  }, [phase, pulse]);

  const color = PHASE_COLOR[phase];

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse }]} />
      <Text testID={`phase-${phase}`} accessibilityLabel={`phase-${phase}`} style={[styles.label, { color }]}>{PHASE_LABEL[phase]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
