import { View, Text, Pressable, StyleSheet, Animated, useWindowDimensions } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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

const ACTION_WIDTH = 80;
const FULL_SWIPE_RATIO = 0.5;

type Props = {
  recording: Recording;
  playState: PlayState;
  onTogglePlay: () => void;
  onDelete: () => void;
  disabled: boolean;
};

export function RecordingItem({ recording, playState, onTogglePlay, onDelete, disabled }: Props) {
  const { t } = useTranslation();
  const isPlaying = playState?.recordingId === recording.id && playState.isPlaying;
  const swipeableRef = useRef<Swipeable>(null);
  const { width: screenWidth } = useWindowDimensions();
  const transXRef = useRef<Animated.AnimatedInterpolation<number> | null>(null);

  const handleSwipeableWillOpen = useCallback((direction: 'left' | 'right') => {
    if (direction !== 'right') return;
    const transX = transXRef.current;
    if (!transX) return;
    const value: number = (transX as ReturnType<typeof Animated.add> & { __getValue(): number }).__getValue();
    if (value < -(screenWidth * FULL_SWIPE_RATIO)) {
      onDelete();
    }
  }, [screenWidth, onDelete]);

  function renderRightActions(
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) {
    transXRef.current = dragX;

    const translateX = dragX.interpolate({
      inputRange: [-ACTION_WIDTH, 0],
      outputRange: [0, ACTION_WIDTH],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View style={[styles.deleteAction, { transform: [{ translateX }] }]}>
        <Pressable
          accessibilityLabel="delete-recording"
          onPress={() => {
            swipeableRef.current?.close();
            onDelete();
          }}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteIcon}>🗑</Text>
          <Text style={styles.deleteLabel}>{t('recordings.delete')}</Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={ACTION_WIDTH}
      overshootRight
      onSwipeableWillOpen={handleSwipeableWillOpen}
      enabled={!disabled}
    >
      <View style={styles.row} testID={`recording-row-${recording.id}`} accessibilityLabel={`recording-row-${recording.id}`}>
        <Pressable
          testID={`play-recording-${recording.id}`}
          accessibilityLabel={`play-recording-${recording.id}`}
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
    </Swipeable>
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
    backgroundColor: '#FAFAFA',
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
  deleteAction: {
    width: ACTION_WIDTH,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  deleteIcon: {
    fontSize: 20,
  },
  deleteLabel: {
    color: '#FFF',
    fontSize: 11,
    marginTop: 2,
  },
});
