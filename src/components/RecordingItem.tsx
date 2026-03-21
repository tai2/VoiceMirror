import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { Recording } from '../lib/recordings';
import type { PlayState } from '../hooks/useRecordings';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    '  ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Props = {
  recording: Recording;
  playState: PlayState;
  onTogglePlay: () => void;
  disabled: boolean;
};

export function RecordingItem({ recording, playState, onTogglePlay, disabled }: Props) {
  const isPlaying = playState?.recordingId === recording.id && playState.isPlaying;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onTogglePlay}
        disabled={disabled}
        style={({ pressed }) => [styles.playButton, disabled && styles.playButtonDisabled, pressed && styles.playButtonPressed]}
        hitSlop={8}
      >
        <Text style={styles.playIcon}>{isPlaying ? '■' : '▶'}</Text>
      </Pressable>
      <View style={styles.meta}>
        <Text style={styles.date}>{formatDate(recording.recordedAt)}</Text>
        <Text style={styles.duration}>{formatDuration(recording.durationMs)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4A9EFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonDisabled: { opacity: 0.35 },
  playButtonPressed: { opacity: 0.7 },
  playIcon: { color: '#FFF', fontSize: 14, lineHeight: 16 },
  meta: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 13, color: '#444' },
  duration: { fontSize: 13, color: '#888', fontVariant: ['tabular-nums'] },
});
