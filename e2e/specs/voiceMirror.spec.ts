import { E2EAudioBridge } from "../helpers/E2EAudioBridge";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

const { voiceOnsetMs: VOICE_ONSET_MS, minRecordingMs: MIN_RECORDING_MS, silenceDurationMs: SILENCE_DURATION_MS } = DEFAULT_SETTINGS;

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

function recordingSelector() {
  return browser.isAndroid
    ? 'android=new UiSelector().descriptionStartsWith("play-recording-")'
    : '-ios predicate string:name BEGINSWITH "play-recording-"';
}

async function createRecording() {
  await bridge.sendVoice(VOICE_ONSET_MS + 200);
  await $("~phase-recording").waitForDisplayed({ timeout: 5_000 });
  await bridge.sendVoice(MIN_RECORDING_MS + 200);
  await bridge.sendSilence(SILENCE_DURATION_MS + 500);
  await $("~phase-playing").waitForDisplayed({ timeout: 10_000 });
  await $("~phase-idle").waitForDisplayed({ timeout: 15_000 });
}

async function swipeLeftOnRow(selector: string, distance: number) {
  const element = $(selector);
  const location = await element.getLocation();
  const size = await element.getSize();
  const { width: screenWidth } = await driver.getWindowSize();
  const startX = Math.round(screenWidth - 20);
  const startY = Math.round(location.y + size.height / 2);
  const endX = Math.max(10, Math.round(startX - distance));

  await driver
    .action("pointer", { parameters: { pointerType: "touch" } })
    .move({ x: startX, y: startY, duration: 0 })
    .down()
    .pause(100)
    .move({ x: endX, y: startY, duration: 600 })
    .pause(100)
    .up()
    .perform();
}

describe("VoiceMirror — swipe to delete", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: 10_000 });
  });

  it("partial swipe reveals delete button, tap deletes recording", async () => {
    await createRecording();

    const sel = recordingSelector();
    await $(sel).waitForExist({ timeout: 10_000 });

    // Swipe on the play button element (part of the row)
    await swipeLeftOnRow(sel, 150);

    const deleteButton = $("~delete-recording");
    await deleteButton.waitForDisplayed({ timeout: 5_000 });
    await deleteButton.click();

    await browser.waitUntil(
      async () => {
        const count = await $$(sel).length;
        return count === 0;
      },
      { timeout: 5_000, timeoutMsg: "Recording was not deleted" },
    );
  });

  it("full swipe left deletes recording immediately", async () => {
    await createRecording();

    const sel = recordingSelector();
    await $(sel).waitForExist({ timeout: 10_000 });

    const { width } = await driver.getWindowSize();
    await swipeLeftOnRow(sel, width * 0.7);

    await browser.waitUntil(
      async () => {
        const count = await $$(sel).length;
        return count === 0;
      },
      { timeout: 5_000, timeoutMsg: "Recording was not deleted by full swipe" },
    );
  });
});
