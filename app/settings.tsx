import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Pressable,
  Alert,
} from "react-native";
import Slider from "@react-native-community/slider";
import { useTranslation } from "react-i18next";
import { useSettings } from "../src/context/SettingsProvider";
import type { AppSettings } from "../src/types/settings";
import { DEFAULT_SETTINGS } from "../src/types/settings";

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
  accentMuted: "#14B8A6",
};

type SliderConfig = {
  key: keyof AppSettings;
  labelKey: string;
  descriptionKey: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  displayValue?: (value: number, t: (key: string) => string) => string;
  formatValue?: (value: number) => string;
};

const SLIDERS: SliderConfig[] = [
  {
    key: "voiceThresholdDb",
    labelKey: "settings.voice_threshold_label",
    descriptionKey: "settings.voice_threshold_description",
    min: -60,
    max: -10,
    step: 1,
    unit: "dB",
  },
  {
    key: "voiceOnsetMs",
    labelKey: "settings.voice_onset_label",
    descriptionKey: "settings.voice_onset_description",
    min: 50,
    max: 1000,
    step: 50,
    unit: "ms",
  },
  {
    key: "silenceThresholdDb",
    labelKey: "settings.silence_threshold_label",
    descriptionKey: "settings.silence_threshold_description",
    min: -70,
    max: -10,
    step: 1,
    unit: "dB",
  },
  {
    key: "silenceDurationMs",
    labelKey: "settings.silence_duration_label",
    descriptionKey: "settings.silence_duration_description",
    min: 100,
    max: 10000,
    step: 100,
    unit: "ms",
  },
  {
    key: "minRecordingMs",
    labelKey: "settings.min_recording_label",
    descriptionKey: "settings.min_recording_description",
    min: 100,
    max: 3000,
    step: 100,
    unit: "ms",
  },
  {
    key: "maxRecordings",
    labelKey: "settings.max_recordings_label",
    descriptionKey: "settings.max_recordings_description",
    min: 0,
    max: 100,
    step: 5,
    unit: "",
    displayValue: (v, t) => (v === 0 ? t("settings.unlimited") : String(v)),
  },
  {
    key: "maxRecordingMs",
    labelKey: "settings.max_recording_duration_label",
    descriptionKey: "settings.max_recording_duration_description",
    min: 0,
    max: 300000,
    step: 5000,
    unit: "s",
    displayValue: (v, t) =>
      v === 0 ? t("settings.unlimited") : `${v / 1000} s`,
    formatValue: (v) => `${v / 1000}`,
  },
];

function SettingSlider({ config }: { config: SliderConfig }) {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const value = settings[config.key];

  const displayValue = config.displayValue
    ? config.displayValue(value, t)
    : `${value} ${config.unit}`;

  return (
    <View style={styles.sliderCard}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{t(config.labelKey)}</Text>
        <View style={styles.valueBadge}>
          <Text style={styles.sliderValue}>{displayValue}</Text>
        </View>
      </View>
      <Text style={styles.sliderDescription}>{t(config.descriptionKey)}</Text>
      <View style={styles.sliderContainer}>
        <Slider
          minimumValue={config.min}
          maximumValue={config.max}
          step={config.step}
          value={value}
          onValueChange={(v: number) => updateSetting(config.key, v)}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.accent}
        />
      </View>
      <View style={styles.sliderRange}>
        <Text style={styles.rangeLabel}>
          {config.formatValue ? config.formatValue(config.min) : config.min}{" "}
          {config.unit}
        </Text>
        <View style={styles.defaultBadge}>
          <Text style={styles.defaultLabel}>
            {t("settings.default_prefix")}{" "}
            {config.formatValue
              ? config.formatValue(DEFAULT_SETTINGS[config.key])
              : DEFAULT_SETTINGS[config.key]}{" "}
            {config.unit}
          </Text>
        </View>
        <Text style={styles.rangeLabel}>
          {config.formatValue ? config.formatValue(config.max) : config.max}{" "}
          {config.unit}
        </Text>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { resetSettings } = useSettings();

  const handleReset = () => {
    Alert.alert(
      t("settings.reset_confirm_title"),
      t("settings.reset_confirm_message"),
      [
        { text: t("settings.reset_cancel"), style: "cancel" },
        {
          text: t("settings.reset_confirm"),
          style: "destructive",
          onPress: () => resetSettings(),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {SLIDERS.map((config) => (
          <SettingSlider key={config.key} config={config} />
        ))}
        <Pressable
          style={({ pressed }) => [
            styles.resetButton,
            pressed && styles.resetButtonPressed,
          ]}
          onPress={handleReset}
        >
          <Text style={styles.resetButtonText}>
            {t("settings.reset_button")}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  sliderCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sliderLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
    flex: 1,
  },
  valueBadge: {
    backgroundColor: "rgba(45, 212, 191, 0.15)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sliderValue: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.accent,
    fontVariant: ["tabular-nums"],
  },
  sliderDescription: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 20,
  },
  sliderContainer: {
    paddingVertical: 8,
  },
  sliderRange: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rangeLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  defaultBadge: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  defaultLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  resetButton: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetButtonPressed: {
    opacity: 0.7,
  },
  resetButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#EF4444",
  },
});
