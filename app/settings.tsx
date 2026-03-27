import { View, Text, StyleSheet, ScrollView, SafeAreaView } from "react-native";
import Slider from "@react-native-community/slider";
import { useTranslation } from "react-i18next";
import { useSettings } from "../src/context/SettingsProvider";
import type { DetectionSettings } from "../src/types/settings";
import { DEFAULT_SETTINGS } from "../src/types/settings";

type SliderConfig = {
  key: keyof DetectionSettings;
  labelKey: string;
  descriptionKey: string;
  min: number;
  max: number;
  step: number;
  unit: string;
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
    min: 300,
    max: 5000,
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
];

function SettingSlider({ config }: { config: SliderConfig }) {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const value = settings[config.key];

  return (
    <View style={styles.sliderCard}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{t(config.labelKey)}</Text>
        <Text style={styles.sliderValue}>
          {value} {config.unit}
        </Text>
      </View>
      <Text style={styles.sliderDescription}>{t(config.descriptionKey)}</Text>
      <Slider
        minimumValue={config.min}
        maximumValue={config.max}
        step={config.step}
        value={value}
        onValueChange={(v: number) => updateSetting(config.key, v)}
        minimumTrackTintColor="#4A9EFF"
        maximumTrackTintColor="#DDD"
      />
      <View style={styles.sliderRange}>
        <Text style={styles.rangeLabel}>
          {config.min} {config.unit}
        </Text>
        <Text style={styles.defaultLabel}>
          {t("settings.default_prefix")} {DEFAULT_SETTINGS[config.key]} {config.unit}
        </Text>
        <Text style={styles.rangeLabel}>
          {config.max} {config.unit}
        </Text>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {SLIDERS.map((config) => (
          <SettingSlider key={config.key} config={config} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FAFAFA" },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 40 },
  sliderCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  sliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sliderLabel: { fontSize: 16, fontWeight: "600", color: "#333" },
  sliderValue: { fontSize: 16, fontWeight: "700", color: "#4A9EFF" },
  sliderDescription: { fontSize: 13, color: "#888", lineHeight: 18 },
  sliderRange: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rangeLabel: { fontSize: 11, color: "#AAA" },
  defaultLabel: { fontSize: 11, color: "#AAA", fontStyle: "italic" },
});
