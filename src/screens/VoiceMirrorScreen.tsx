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

  const { recordings, playState, addRecording, deleteRecording, togglePlay } = useRecordings(
    { onWillPlay: stableSuspend, onDidStop: stableResume },
    audioContext,
    recordingsRepository,
    decoderService,
    settings.maxRecordings,
  );

  addRecordingRef.current = addRecording;
  suspendRef.current = suspendForListPlayback;
  resumeRef.current = resumeFromListPlayback;

  const isPaused = phase === "paused";

  if (permissionDenied) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>{t('main.error_title')}</Text>
          <Text style={styles.errorBody}>
            {t('main.error_body')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.hint}>{t('main.hint_requesting')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topBar}>
        <View style={styles.topBarSpacer} />
        <Pressable
          onPress={() => router.push("/settings")}
          style={({ pressed }) => [
            styles.settingsButton,
            pressed && styles.settingsButtonPressed,
          ]}
        >
          <Text style={styles.settingsIcon}>&#x2699;</Text>
        </Pressable>
      </View>
      <View style={styles.monitor}>
        <PhaseDisplay phase={phase} />
        <View style={styles.meterContainer}>
          <AudioLevelMeter history={levelHistory} phase={phase} />
        </View>
        <Text style={styles.hint}>
          {isPaused ? t('main.hint_paused') : t('main.hint_listening')}
        </Text>
        {recordingError && (
          <Text style={styles.recordingError}>{t(`main.${recordingError}`)}</Text>
        )}
        <Pressable
          testID="toggle-pause-button"
          accessibilityLabel="toggle-pause-button"
          onPress={togglePause}
          style={({ pressed }) => [
            styles.pauseButton,
            pressed && styles.pauseButtonPressed,
          ]}
        >
          <Text style={styles.pauseButtonLabel}>
            {isPaused ? t('main.button_resume') : t('main.button_pause')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.divider} />

      <RecordingsList
        recordings={recordings}
        playState={playState}
        onTogglePlay={togglePlay}
        onDelete={(r) => deleteRecording(r.id)}
        disabled={phase === "recording"}
      />
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
    backgroundColor: "#FAFAFA",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topBarSpacer: {
    flex: 1,
  },
  settingsButton: {
    padding: 8,
  },
  settingsButtonPressed: {
    opacity: 0.5,
  },
  settingsIcon: {
    fontSize: 24,
    color: "#888",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  monitor: {
    alignItems: "center",
    paddingHorizontal: 32,
    paddingVertical: 32,
    gap: 24,
  },
  meterContainer: {
    width: "100%",
    alignItems: "center",
  },
  hint: {
    color: "#AAA",
    fontSize: 14,
    textAlign: "center",
  },
  pauseButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 30,
    backgroundColor: "#EEEEEE",
  },
  pauseButtonPressed: {
    backgroundColor: "#DDDDDD",
  },
  pauseButtonLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#555555",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#DDD",
  },
  recordingError: {
    color: "#CC3333",
    fontSize: 14,
    textAlign: "center",
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
    textAlign: "center",
  },
  errorBody: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
  },
});
