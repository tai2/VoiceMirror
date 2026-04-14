import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Recording } from "../lib/recordings";
import type { PlayState } from "../hooks/useRecordings";

// Design tokens
const colors = {
  background: "#0A0A0B",
  surface: "#141416",
  surfaceElevated: "#1C1C1F",
  border: "#2A2A2E",
  textPrimary: "#FAFAFA",
  textSecondary: "#A1A1AA",
  textMuted: "#71717A",
  accent: "#2DD4BF",
  accentLight: "rgba(45, 212, 191, 0.15)",
  playing: "#5EEAD4",
  playingLight: "rgba(94, 234, 212, 0.15)",
  danger: "#EF4444",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " at " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const ACTION_WIDTH = 88;
const FULL_SWIPE_RATIO = 0.5;

type Props = {
  recording: Recording;
  playState: PlayState;
  onTogglePlay: () => void;
  onDelete: () => void;
  disabled: boolean;
};

export function RecordingItem({
  recording,
  playState,
  onTogglePlay,
  onDelete,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const isPlaying =
    playState?.recordingId === recording.id && playState.isPlaying;
  const swipeableRef = useRef<Swipeable>(null);
  const { width: screenWidth } = useWindowDimensions();
  const transXRef = useRef<Animated.AnimatedInterpolation<number> | null>(null);

  const handleSwipeableWillOpen = useCallback(
    (direction: "left" | "right") => {
      if (direction !== "right") return;
      const transX = transXRef.current;
      if (!transX) return;
      const value: number = (
        transX as ReturnType<typeof Animated.add> & { __getValue(): number }
      ).__getValue();
      if (value < -(screenWidth * FULL_SWIPE_RATIO)) {
        onDelete();
      }
    },
    [screenWidth, onDelete],
  );

  function renderRightActions(
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) {
    transXRef.current = dragX;

    const translateX = dragX.interpolate({
      inputRange: [-ACTION_WIDTH, 0],
      outputRange: [0, ACTION_WIDTH],
      extrapolate: "clamp",
    });

    return (
      <Animated.View
        style={[styles.deleteAction, { transform: [{ translateX }] }]}
      >
        <Pressable
          accessibilityLabel="delete-recording"
          onPress={() => {
            swipeableRef.current?.close();
            onDelete();
          }}
          style={styles.deleteButton}
        >
          <View style={styles.deleteIconContainer}>
            <Text style={styles.deleteIconText}>X</Text>
          </View>
          <Text style={styles.deleteLabel}>{t("recordings.delete")}</Text>
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
      <View
        style={[styles.row, isPlaying && styles.rowPlaying]}
        testID={`recording-row-${recording.id}`}
        accessibilityLabel={`recording-row-${recording.id}`}
      >
        <Pressable
          testID={`play-recording-${recording.id}`}
          accessibilityLabel={`play-recording-${recording.id}`}
          onPress={onTogglePlay}
          disabled={disabled}
          style={({ pressed }) => [
            styles.playButton,
            isPlaying && styles.playButtonPlaying,
            disabled && styles.playButtonDisabled,
            pressed && styles.playButtonPressed,
          ]}
          hitSlop={8}
        >
          <Text style={[styles.playIcon, isPlaying && styles.playIconPlaying]}>
            {isPlaying ? "\u25A0" : "\u25B6"}
          </Text>
        </Pressable>
        <View style={styles.meta}>
          <View style={styles.metaLeft}>
            <Text style={[styles.date, isPlaying && styles.textPlaying]}>
              {formatDate(recording.recordedAt)}
            </Text>
          </View>
          <View style={styles.durationBadge}>
            <Text style={styles.duration}>
              {formatDuration(recording.durationMs)}
            </Text>
          </View>
        </View>
      </View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  rowPlaying: {
    backgroundColor: colors.playingLight,
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  playButtonPlaying: {
    backgroundColor: colors.playing,
    borderColor: colors.playing,
  },
  playButtonDisabled: { opacity: 0.35 },
  playButtonPressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
  playIcon: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
  },
  playIconPlaying: {
    color: colors.textPrimary,
  },
  meta: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaLeft: {
    flex: 1,
  },
  date: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  textPlaying: {
    color: colors.playing,
  },
  durationBadge: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  duration: {
    fontSize: 13,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  deleteAction: {
    width: ACTION_WIDTH,
    backgroundColor: colors.danger,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButton: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    gap: 6,
  },
  deleteIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteIconText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
  },
  deleteLabel: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },
});
