import { E2EAudioBridge } from "../helpers/E2EAudioBridge";
import {
  VOICE_ONSET_MS,
  MIN_RECORDING_MS,
  SILENCE_DURATION_MS,
} from "../../src/constants/audio";

let bridge: E2EAudioBridge;

before(() => {
  bridge = new E2EAudioBridge(9876);
});

after(async () => {
  await bridge.close();
});

beforeEach(async () => {
  // Wait for the app to load and confirm E2E mode is active
  const e2eIndicator = $("~e2e-mode");
  await e2eIndicator.waitForExist({ timeout: 10_000 });
});

afterEach(async () => {
  await driver.reloadSession();
});

describe("VoiceMirror — core loop", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: 10_000 });
  });
  it("shows idle phase on launch", async () => {
    await expect($("~phase-idle")).toBeDisplayed();
  });
  it("transitions to recording when voice is sustained", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: 5_000 });
  });
  it("does not record on brief voice bursts shorter than onset threshold", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS - 100);
    await bridge.sendSilence(500);
    await expect($("~phase-idle")).toBeDisplayed();
    await expect($("~phase-recording")).not.toBeDisplayed();
  });
  it("transitions from recording to playing after sustained silence", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: 5_000 });
    await bridge.sendVoice(MIN_RECORDING_MS + 200);
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-playing").waitForDisplayed({ timeout: 10_000 });
  });
  it("returns to idle after playback completes", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: 5_000 });
    await bridge.sendVoice(MIN_RECORDING_MS + 200);
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-playing").waitForDisplayed({ timeout: 10_000 });
    await $("~phase-idle").waitForDisplayed({ timeout: 15_000 });
  });
  it("adds a recording to the list after the loop completes", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: 5_000 });
    await bridge.sendVoice(MIN_RECORDING_MS + 200);
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-playing").waitForDisplayed({ timeout: 10_000 });
    await $("~phase-idle").waitForDisplayed({ timeout: 15_000 });
    const recordingSelector = browser.isAndroid
      ? 'android=new UiSelector().descriptionStartsWith("play-recording-")'
      : '-ios predicate string:name BEGINSWITH "play-recording-"';
    const playButton = $(recordingSelector);
    await playButton.waitForExist({ timeout: 10_000 });
    const items = $$(recordingSelector);
    expect(items).toBeElementsArrayOfSize({ gte: 1 });
  });
});

describe("VoiceMirror — pause / resume", () => {
  it("pauses and resumes monitoring", async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: 10_000 });

    await $("~toggle-pause-button").click();
    await $("~phase-paused").waitForDisplayed({ timeout: 5_000 });

    await $("~toggle-pause-button").click();
    await $("~phase-idle").waitForDisplayed({ timeout: 5_000 });
  });
});
