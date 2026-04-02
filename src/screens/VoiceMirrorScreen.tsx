import { View, Text, StyleSheet, SafeAreaView, Pressable } from "react-native";
import { useRef, useCallback } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useVoiceMirror } from "../hooks/useVoiceMirror";
import { useRecordings } from "../hooks/useRecordings";
import { AudioLevelMeter } from "../components/AudioLevelMeter";
import { PhaseDisplay } from "../components/PhaseDisplay";
import { RecordingsList } from "../components/RecordingsList";
import {
  AudioContextProvider,
  useAudioContext,
} from "../context/AudioContextProvider";
import { useServices } from "../context/ServicesProvider";
import { useSettings } from "../context/SettingsProvider";

// Design tokens
const colors = {
  background: "#0A0A0B",
  surface: "#141416",
  surfaceElevated: "#1C1C1F",
  border: "#2A2A2E",
  textPrimary: "#FAFAFA",
  textSecondary: "#A1A1AA",
  textMuted: "#71717A",
  accent: "#3B82F6",
  accentHover: "#2563EB",
  recording: "#EF4444",
  playing: "#22C55E",
  paused: "#71717A",
};

function VoiceMirrorContent() {
  const { t } = useTranslation();
  const audioContext = useAudioContext();
  const {
    recordingService,
    encoderService,
    decoderService,
    recordingsRepository,
  } = useServices();
  const { settings } = useSettings();
  const router = useRouter();

  const addRecordingRef = useRef<
    (filePath: string, durationMs: number) => void
  >(() => {});
  const suspendRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const resumeRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const stableAddRecording = useCallback(
    (filePath: string, durationMs: number) => {
      addRecordingRef.current(filePath, durationMs);
    },
    [],
  );

  const stableSuspend = useCallback(() => suspendRef.current(), []);
  const stableResume = useCallback(() => resumeRef.current(), []);

  const {
    phase,
    levelHistory,
    currentDb,
    hasPermission,
    permissionDenied,
    recordingError,
    togglePause,
    suspendForListPlayback,
    resumeFromListPlayback,
  } = useVoiceMirror(
    stableAddRecording,
    audioContext,
    recordingService,
    encoderService,
    recordingsRepository,
    settings,
  );

  const { recordings, playState, levelHistory: recordingsLevelHistory, addRecording, deleteRecording, togglePlay } = useRecordings(
    { onWillPlay: stableSuspend, onDidStop: stableResume },
    audioContext,
    recordingsRepository,
    decoderService,
    settings.maxRecordings,
  );

  addRecordingRef.current = addRecording;
  suspendRef.current = suspendForListPlayback;
  resumeRef.current = resumeFromListPlayback;

  const isListPlaying = playState?.isPlaying ?? false;
  const activeLevelHistory = isListPlaying ? recordingsLevelHistory : levelHistory;
  const meterPhase = isListPlaying ? 'playing' as const : phase;
  const isPaused = phase === "paused";
  const isRecording = phase === "recording";

  if (permissionDenied) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <View style={styles.errorCard}>
            <View style={styles.errorIconContainer}>
              <Text style={styles.errorIcon}>!</Text>
            </View>
            <Text style={styles.errorTitle}>{t('main.error_title')}</Text>
            <Text style={styles.errorBody}>
              {t('main.error_body')}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <View style={styles.loadingContainer}>
            <View style={styles.loadingDot} />
            <Text style={styles.hint}>{t('main.hint_requesting')}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topBar}>
        <Text style={styles.appTitle}>VoiceMirror</Text>
        <Pressable
          onPress={() => router.push("/settings")}
          style={({ pressed }) => [
            styles.settingsButton,
            pressed && styles.settingsButtonPressed,
          ]}
        >
          <View style={styles.settingsIconContainer}>
            <Text style={styles.settingsIcon}>&#x2699;</Text>
          </View>
        </Pressable>
      </View>
      
      <View style={styles.monitorCard}>
        <PhaseDisplay phase={meterPhase} />
        <View style={styles.meterContainer}>
          <AudioLevelMeter
            history={activeLevelHistory}
            phase={meterPhase}
            currentDb={isListPlaying ? null : currentDb}
            voiceThresholdDb={settings.voiceThresholdDb}
            silenceThresholdDb={settings.silenceThresholdDb}
          />
        </View>
        <Text style={styles.hint}>
          {isPaused ? t('main.hint_paused') : t('main.hint_listening')}
        </Text>
        {recordingError && (
          <View style={styles.errorBadge}>
            <Text style={styles.recordingError}>{t(`main.${recordingError}`)}</Text>
          </View>
        )}
        <Pressable
          testID="toggle-pause-button"
          accessibilityLabel="toggle-pause-button"
          onPress={togglePause}
          style={({ pressed }) => [
            styles.pauseButton,
            isPaused && styles.pauseButtonActive,
            isRecording && styles.pauseButtonRecording,
            pressed && styles.pauseButtonPressed,
          ]}
        >
          <Text style={[
            styles.pauseButtonLabel,
            isPaused && styles.pauseButtonLabelActive,
          ]}>
            {isPaused ? t('main.button_resume') : t('main.button_pause')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.recordingsSection}>
        <View style={styles.recordingsHeader}>
          <Text style={styles.recordingsTitle}>{t('recordings.title') || 'Recordings'}</Text>
          <View style={styles.recordingsCountBadge}>
            <Text style={styles.recordingsCount}>{recordings.length}</Text>
          </View>
        </View>
        <RecordingsList
          recordings={recordings}
          playState={playState}
          onTogglePlay={togglePlay}
          onDelete={(r) => deleteRecording(r.id)}
          disabled={phase === "recording"}
        />
      </View>
    </SafeAreaView>
  );
}

export function VoiceMirrorScreen() {
  return (
    <AudioContextProvider>
      <VoiceMirrorContent />
    </AudioContextProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  appTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  settingsButton: {
    padding: 4,
  },
  settingsButtonPressed: {
    opacity: 0.6,
  },
  settingsIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsIcon: {
    fontSize: 20,
    color: colors.textSecondary,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  loadingContainer: {
    alignItems: "center",
    gap: 16,
  },
  loadingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  monitorCard: {
    alignItems: "center",
    marginHorizontal: 20,
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 24,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  meterContainer: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 8,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    fontWeight: "500",
  },
  pauseButton: {
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 160,
    alignItems: "center",
  },
  pauseButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pauseButtonRecording: {
    borderColor: colors.recording,
  },
  pauseButtonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  pauseButtonLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  pauseButtonLabelActive: {
    color: colors.textPrimary,
  },
  recordingsSection: {
    flex: 1,
    marginTop: 24,
  },
  recordingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  recordingsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  recordingsCountBadge: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordingsCount: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    fontVariant: ["tabular-nums"],
  },
  errorCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 320,
  },
  errorIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  errorIcon: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.recording,
  },
  errorBadge: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  recordingError: {
    color: colors.recording,
    fontSize: 13,
    textAlign: "center",
    fontWeight: "500",
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.textPrimary,
    textAlign: "center",
  },
  errorBody: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
