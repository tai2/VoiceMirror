import { StatusBar } from "expo-status-bar";
import { View, Text, StyleSheet, StatusBar as RNStatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { useSyncExternalStore } from "react";
import { I18nProvider } from "../src/context/I18nProvider";
import { useTranslation } from "react-i18next";
import { ServicesProvider } from "../src/context/ServicesProvider";
import { SettingsProvider } from "../src/context/SettingsProvider";
import { RealAudioRecordingService } from "../src/services/AudioRecordingService";
import { RealAudioEncoderService } from "../src/services/AudioEncoderService";
import { RealAudioDecoderService } from "../src/services/AudioDecoderService";
import { RealRecordingsRepository } from "../src/repositories/RecordingsRepository";
import { RealSettingsRepository } from "../src/repositories/SettingsRepository";
import {
  E2EAudioRecordingService,
  type E2EConnectionStatus,
} from "../src/services/E2EAudioRecordingService";

const isE2E = process.env.EXPO_PUBLIC_E2E === "1";

const realServices = {
  recordingService: new RealAudioRecordingService(),
  encoderService: new RealAudioEncoderService(),
  decoderService: new RealAudioDecoderService(),
  recordingsRepository: new RealRecordingsRepository(),
};

const e2eRecordingService = new E2EAudioRecordingService();

const e2eServices = {
  ...realServices,
  recordingService: e2eRecordingService,
};

const settingsRepository = new RealSettingsRepository();

const CONNECTION_STATUS_LABEL: Record<E2EConnectionStatus, string> = {
  disconnected: "WS: Disconnected",
  connecting: "WS: Connecting…",
  connected: "WS: Connected",
};

const CONNECTION_STATUS_COLOR: Record<E2EConnectionStatus, string> = {
  disconnected: "#FF4444",
  connecting: "#FFAA00",
  connected: "#44BB44",
};

function E2EBanner() {
  const connectionStatus = useSyncExternalStore(
    e2eRecordingService.subscribe,
    e2eRecordingService.getSnapshot,
  );

  return (
    <View style={styles.e2eBanner} pointerEvents="none">
      <Text
        testID="e2e-mode"
        accessibilityLabel="e2e-mode"
        style={styles.e2eLabel}
      >
        E2E
      </Text>
      <View
        style={[
          styles.connectionDot,
          { backgroundColor: CONNECTION_STATUS_COLOR[connectionStatus] },
        ]}
      />
      <Text
        testID="e2e-connection-status"
        accessibilityLabel={`e2e-connection-${connectionStatus}`}
        style={styles.connectionLabel}
      >
        {CONNECTION_STATUS_LABEL[connectionStatus]}
      </Text>
    </View>
  );
}

function RootStack() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ title: "VoiceMirror", headerShown: false }}
      />
      <Stack.Screen
        name="settings"
        options={{ title: t("settings.title"), presentation: "card" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <I18nProvider>
        <ServicesProvider services={isE2E ? e2eServices : realServices}>
          <SettingsProvider repository={settingsRepository}>
            <RootStack />
            {isE2E && <E2EBanner />}
            <StatusBar style="dark" />
          </SettingsProvider>
        </ServicesProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  e2eBanner: {
    position: "absolute",
    top: RNStatusBar.currentHeight ?? 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 8,
  },
  e2eLabel: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 4,
  },
  connectionLabel: {
    color: "#DDD",
    fontSize: 11,
    fontWeight: "500",
  },
});
