import { View, Text, StyleSheet, SafeAreaView, Pressable } from 'react-native';
import { useVoiceMirror } from '../hooks/useVoiceMirror';
import { useRecordings } from '../hooks/useRecordings';
import { AudioLevelMeter } from '../components/AudioLevelMeter';
import { PhaseDisplay } from '../components/PhaseDisplay';
import { RecordingsList } from '../components/RecordingsList';

export function VoiceMirrorScreen() {
  const { recordings, playState, addRecording, togglePlay } = useRecordings();
  const { phase, levelHistory, hasPermission, permissionDenied, recordingError, togglePause } =
    useVoiceMirror(addRecording);
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
      <View style={styles.monitor}>
        <PhaseDisplay phase={phase} />
        <View style={styles.meterContainer}>
          <AudioLevelMeter history={levelHistory} phase={phase} />
        </View>
        <Text style={styles.hint}>
          {isPaused ? 'Monitoring paused.' : 'Speak to begin. Silence ends the take.'}
        </Text>
        {recordingError && <Text style={styles.recordingError}>{recordingError}</Text>}
        <Pressable
          onPress={togglePause}
          style={({ pressed }) => [styles.pauseButton, pressed && styles.pauseButtonPressed]}
        >
          <Text style={styles.pauseButtonLabel}>{isPaused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      </View>

      <View style={styles.divider} />

      <RecordingsList
        recordings={recordings}
        playState={playState}
        onTogglePlay={togglePlay}
      />
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
  },
  monitor: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 32,
    gap: 24,
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
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#DDD',
  },
  recordingError: {
    color: '#CC3333',
    fontSize: 14,
    textAlign: 'center',
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
