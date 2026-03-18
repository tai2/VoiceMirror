import { View, Text, StyleSheet, SafeAreaView, Pressable } from 'react-native';
import { useVoiceMirror } from '../hooks/useVoiceMirror';
import { AudioLevelMeter } from '../components/AudioLevelMeter';
import { PhaseDisplay } from '../components/PhaseDisplay';

export function VoiceMirrorScreen() {
  const { phase, levelHistory, hasPermission, permissionDenied, togglePause } = useVoiceMirror();
  const isPaused = phase === 'paused';

  if (permissionDenied) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Microphone access required</Text>
          <Text style={styles.errorBody}>
            Go to Settings → VoiceMirror → Microphone and allow access.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.hint}>Requesting microphone access…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <PhaseDisplay phase={phase} />
        <View style={styles.meterContainer}>
          <AudioLevelMeter history={levelHistory} phase={phase} />
        </View>
        <Text style={styles.hint}>
          {isPaused ? 'Monitoring paused.' : 'Speak to begin. Silence ends the take.'}
        </Text>
        <Pressable
          onPress={togglePause}
          style={({ pressed }) => [styles.pauseButton, pressed && styles.pauseButtonPressed]}
        >
          <Text style={styles.pauseButtonLabel}>{isPaused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 32,
  },
  meterContainer: {
    width: '100%',
    alignItems: 'center',
  },
  hint: {
    color: '#AAA',
    fontSize: 14,
    textAlign: 'center',
  },
  pauseButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 30,
    backgroundColor: '#EEEEEE',
  },
  pauseButtonPressed: {
    backgroundColor: '#DDDDDD',
  },
  pauseButtonLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#555555',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
});
