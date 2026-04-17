import { E2EAudioBridge } from "../helpers/E2EAudioBridge";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

const {
  voiceOnsetMs: VOICE_ONSET_MS,
  minRecordingMs: MIN_RECORDING_MS,
  silenceDurationMs: SILENCE_DURATION_MS,
} = DEFAULT_SETTINGS;

// UiAutomator2 commands can take several seconds.
// These timeouts provide comfortable headroom.
const WAIT_SHORT = 10_000;
const WAIT_MEDIUM = 30_000;
const WAIT_LONG = 60_000;

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
  await e2eIndicator.waitForExist({ timeout: WAIT_MEDIUM });
});

afterEach(async () => {
  await driver.reloadSession();
});

describe("VoiceMirror — core loop", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });
  it("shows idle phase on launch", async () => {
    await expect($("~phase-idle")).toBeDisplayed();
  });
  it("transitions to recording when voice is sustained", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: WAIT_SHORT });
  });
  it("does not record on brief voice bursts shorter than onset threshold", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS - 100);
    await bridge.sendSilence(500);
    await expect($("~phase-idle")).toBeDisplayed();
    await expect($("~phase-recording")).not.toBeDisplayed();
  });
  it("transitions from recording to playing after sustained silence", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: WAIT_SHORT });
    await bridge.sendVoice(MIN_RECORDING_MS + 200);
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-playing").waitForDisplayed({ timeout: WAIT_MEDIUM });
  });
  it("returns to idle after playback completes", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: WAIT_SHORT });
    await bridge.sendVoice(MIN_RECORDING_MS + 200);
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-playing").waitForDisplayed({ timeout: WAIT_MEDIUM });
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_LONG });
  });
  it("adds a recording to the list after the loop completes", async () => {
    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: WAIT_SHORT });
    await bridge.sendVoice(MIN_RECORDING_MS + 200);
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-playing").waitForDisplayed({ timeout: WAIT_MEDIUM });
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_LONG });
    const recordingSelector = browser.isAndroid
      ? 'android=new UiSelector().descriptionStartsWith("play-recording-")'
      : '-ios predicate string:name BEGINSWITH "play-recording-"';
    const playButton = $(recordingSelector);
    await playButton.waitForExist({ timeout: WAIT_SHORT });
    const items = $$(recordingSelector);
    expect(items).toBeElementsArrayOfSize({ gte: 1 });
  });
});

describe("VoiceMirror — pause / resume", () => {
  it("pauses and resumes monitoring", async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });

    await $("~toggle-pause-button").click();
    await $("~phase-paused").waitForDisplayed({ timeout: WAIT_SHORT });

    await $("~toggle-pause-button").click();
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });
});

function recordingSelector() {
  return browser.isAndroid
    ? 'android=new UiSelector().descriptionStartsWith("play-recording-")'
    : '-ios predicate string:name BEGINSWITH "play-recording-"';
}

async function createRecording() {
  await bridge.sendVoice(VOICE_ONSET_MS + 200);
  await $("~phase-recording").waitForDisplayed({ timeout: WAIT_MEDIUM });
  await bridge.sendVoice(MIN_RECORDING_MS + 200);
  await bridge.sendSilence(SILENCE_DURATION_MS + 500);
  await $("~phase-playing").waitForDisplayed({ timeout: WAIT_MEDIUM });
  await $("~phase-idle").waitForDisplayed({ timeout: WAIT_LONG });
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

describe("VoiceMirror — settings navigation", () => {
  it("navigates to settings screen and back", async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });

    await $("~settings-button").click();

    await $("~reset-settings-button").scrollIntoView();
    await $("~reset-settings-button").waitForExist({ timeout: WAIT_SHORT });

    await driver.back();

    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });
});

describe("VoiceMirror — empty state", () => {
  it("shows empty state when no recordings exist", async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });

    await expect($("~recordings-empty")).toBeDisplayed();
  });
});

describe("VoiceMirror — list playback", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });

  it("plays a recording from the list and shows playing phase", async () => {
    await createRecording();

    const sel = recordingSelector();
    const playButton = $(sel);
    await playButton.waitForExist({ timeout: WAIT_SHORT });

    await playButton.click();

    await $("~phase-playing").waitForDisplayed({ timeout: WAIT_SHORT });

    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_LONG });
  });

  it("stops playback when tapping the same recording again", async () => {
    await createRecording();

    const sel = recordingSelector();
    const playButton = $(sel);
    await playButton.waitForExist({ timeout: WAIT_SHORT });

    await playButton.click();
    await $("~phase-playing").waitForDisplayed({ timeout: WAIT_SHORT });

    await playButton.click();

    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_MEDIUM });
  });

  it("resumes monitoring after list playback ends naturally", async () => {
    await createRecording();

    const sel = recordingSelector();
    await $(sel).waitForExist({ timeout: WAIT_SHORT });

    await $(sel).click();
    await $("~phase-playing").waitForDisplayed({ timeout: WAIT_SHORT });

    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_LONG });

    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: WAIT_SHORT });
  });
});

describe("VoiceMirror — multiple recordings", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });

  it("accumulates multiple recordings in the list", async () => {
    await createRecording();

    const sel = recordingSelector();
    await $(sel).waitForExist({ timeout: WAIT_SHORT });
    const countAfterFirst = await $$(sel).length;
    expect(countAfterFirst).toBe(1);

    await createRecording();

    await browser.waitUntil(
      async () => {
        const count = await $$(sel).length;
        return count === 2;
      },
      { timeout: WAIT_SHORT, timeoutMsg: "Expected 2 recordings in the list" },
    );
  });
});

describe("VoiceMirror — pause during recording", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });

  it("discards recording when paused mid-recording", async () => {
    await expect($("~recordings-empty")).toBeDisplayed();

    await bridge.sendVoice(VOICE_ONSET_MS + 200);
    await $("~phase-recording").waitForDisplayed({ timeout: WAIT_SHORT });

    await $("~toggle-pause-button").click();
    await $("~phase-paused").waitForDisplayed({ timeout: WAIT_SHORT });

    const sel = recordingSelector();
    const count = await $$(sel).length;
    expect(count).toBe(0);

    await $("~toggle-pause-button").click();
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });
});

describe("VoiceMirror — swipe to delete", () => {
  beforeEach(async () => {
    await bridge.sendSilence(SILENCE_DURATION_MS + 500);
    await $("~phase-idle").waitForDisplayed({ timeout: WAIT_SHORT });
  });

  it("partial swipe reveals delete button, tap deletes recording", async () => {
    await createRecording();

    const sel = recordingSelector();
    await $(sel).waitForExist({ timeout: WAIT_SHORT });

    // Swipe on the play button element (part of the row)
    const { width } = await driver.getWindowSize();
    await swipeLeftOnRow(sel, width * 0.3);

    const deleteButton = $("~delete-recording");
    await deleteButton.waitForDisplayed({ timeout: WAIT_SHORT });
    await deleteButton.click();

    await browser.waitUntil(
      async () => {
        const count = await $$(sel).length;
        return count === 0;
      },
      { timeout: WAIT_SHORT, timeoutMsg: "Recording was not deleted" },
    );
  });

  it("full swipe left deletes recording immediately", async () => {
    await createRecording();

    const sel = recordingSelector();
    await $(sel).waitForExist({ timeout: WAIT_SHORT });

    const { width } = await driver.getWindowSize();
    await swipeLeftOnRow(sel, width * 0.7);

    await browser.waitUntil(
      async () => {
        const count = await $$(sel).length;
        return count === 0;
      },
      {
        timeout: WAIT_SHORT,
        timeoutMsg: "Recording was not deleted by full swipe",
      },
    );
  });
});
