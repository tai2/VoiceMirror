import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Phase } from '../hooks/types';

const PHASE_I18N_KEY: Record<Phase, string> = {
  idle: 'phase.idle',
  recording: 'phase.recording',
  playing: 'phase.playing',
  paused: 'phase.paused',
};

const PHASE_COLOR: Record<Phase, string> = {
  idle: '#3B82F6',
  recording: '#EF4444',
  playing: '#22C55E',
  paused: '#71717A',
};

const PHASE_BG: Record<Phase, string> = {
  idle: 'rgba(59, 130, 246, 0.15)',
  recording: 'rgba(239, 68, 68, 0.15)',
  playing: 'rgba(34, 197, 94, 0.15)',
  paused: 'rgba(113, 113, 122, 0.15)',
};

type Props = { phase: Phase };

export function PhaseDisplay({ phase }: Props) {
  const { t } = useTranslation();
  const pulse = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ]),
    );
    
    const scaleAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ]),
    );

    const recordingScaleAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.2, duration: 500, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 500, useNativeDriver: true }),
      ]),
    );

    if (phase === 'idle') {
      pulseAnimation.start();
      scaleAnimation.start();
    } else if (phase === 'recording') {
      pulse.setValue(1);
      recordingScaleAnimation.start();
    } else {
      pulseAnimation.stop();
      scaleAnimation.stop();
      pulse.setValue(1);
      scale.setValue(1);
    }

    return () => {
      pulseAnimation.stop();
      scaleAnimation.stop();
      recordingScaleAnimation.stop();
    };
  }, [phase, pulse, scale]);

  const color = PHASE_COLOR[phase];
  const bgColor = PHASE_BG[phase];

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.dotContainer}>
        <Animated.View 
          style={[
            styles.dotGlow, 
            { 
              backgroundColor: color, 
              opacity: pulse,
              transform: [{ scale }],
            }
          ]} 
        />
        <Animated.View 
          style={[
            styles.dot, 
            { 
              backgroundColor: color,
              transform: [{ scale: Animated.multiply(scale, 0.7).interpolate({
                inputRange: [0.7, 0.84],
                outputRange: [1, 1.2],
              }) }],
            }
          ]} 
        />
      </View>
      <Text 
        testID={`phase-${phase}`} 
        accessibilityLabel={`phase-${phase}`} 
        style={[styles.label, { color }]}
      >
        {t(PHASE_I18N_KEY[phase])}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
  },
  dotContainer: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotGlow: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
