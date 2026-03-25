import { View, Text, StyleSheet, ScrollView, SafeAreaView } from "react-native";
import Slider from "@react-native-community/slider";
import { useSettings } from "../src/context/SettingsProvider";
import type { DetectionSettings } from "../src/types/settings";
import { DEFAULT_SETTINGS } from "../src/types/settings";

type SliderConfig = {
  key: keyof DetectionSettings;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

const SLIDERS: SliderConfig[] = [
  {
    key: "voiceThresholdDb",
    label: "Voice Threshold",
    description:
      "Audio level (in dB) that must be exceeded to begin voice onset detection. Lower values make detection more sensitive to quiet speech; higher values require louder input.",
    min: -60,
    max: -10,
    step: 1,
    unit: "dB",
  },
  {
    key: "voiceOnsetMs",
    label: "Voice Onset Duration",
    description:
      "How long (in ms) the audio must stay above the voice threshold before recording starts. Shorter values react faster but may trigger on brief noises; longer values are more conservative.",
    min: 50,
    max: 1000,
    step: 50,
    unit: "ms",
  },
  {
    key: "silenceThresholdDb",
    label: "Silence Threshold",
    description:
      "Audio level (in dB) below which silence detection begins. Should be lower than the voice threshold. Lower values tolerate more background noise before ending a recording.",
    min: -70,
    max: -10,
    step: 1,
    unit: "dB",
  },
  {
    key: "silenceDurationMs",
    label: "Silence Duration",
    description:
      "How long (in ms) silence must persist before the recording ends. Longer values allow natural pauses in speech without cutting off; shorter values end recordings faster.",
    min: 300,
    max: 5000,
    step: 100,
    unit: "ms",
  },
  {
    key: "minRecordingMs",
    label: "Min Recording Duration",
    description:
      "Minimum amount of speech (in ms) that must be captured before silence can end the recording. Prevents very short accidental recordings.",
    min: 100,
    max: 3000,
    step: 100,
    unit: "ms",
  },
];

function SettingSlider({ config }: { config: SliderConfig }) {
  const { settings, updateSetting } = useSettings();
  const value = settings[config.key];

  return (
    <View style={styles.sliderCard}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{config.label}</Text>
        <Text style={styles.sliderValue}>
          {value} {config.unit}
        </Text>
      </View>
      <Text style={styles.sliderDescription}>{config.description}</Text>
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
          default: {DEFAULT_SETTINGS[config.key]} {config.unit}
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
