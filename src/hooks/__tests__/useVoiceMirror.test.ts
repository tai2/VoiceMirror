jest.mock("../../lib/sentryHelpers", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useVoiceMirror } from "../useVoiceMirror";
import { StubAudioRecordingService } from "../../__tests__/stubs/stubAudioRecordingService";
import { StubAudioEncoderService } from "../../__tests__/stubs/stubAudioEncoderService";
import { StubRecordingsRepository } from "../../__tests__/stubs/stubRecordingsRepository";
import {
  makeStubAudioContext,
  makeStubBufferSourceNode,
} from "../../__tests__/stubs/stubAudioContext";
import { LEVEL_HISTORY_SIZE } from "../../constants/audio";
import { DEFAULT_SETTINGS } from "../../types/settings";

const {
  voiceThresholdDb: VOICE_THRESHOLD_DB,
  silenceThresholdDb: SILENCE_THRESHOLD_DB,
  voiceOnsetMs: VOICE_ONSET_MS,
  silenceDurationMs: SILENCE_DURATION_MS,
  minRecordingMs: MIN_RECORDING_MS,
} = DEFAULT_SETTINGS;

function makeLoudChunk(durationMs = 100, sampleRate = 44100): Float32Array {
  const numFrames = Math.round((durationMs / 1000) * sampleRate);
  const rms = Math.pow(10, (VOICE_THRESHOLD_DB + 10) / 20);
  return new Float32Array(numFrames).fill(rms);
}

function makeSilentChunk(durationMs = 100, sampleRate = 44100): Float32Array {
  const numFrames = Math.round((durationMs / 1000) * sampleRate);
  const rms = Math.pow(10, (SILENCE_THRESHOLD_DB - 10) / 20);
  return new Float32Array(numFrames).fill(rms);
}

function makeRisingChunk(durationMs = 100, sampleRate = 44100): Float32Array {
  const numFrames = Math.round((durationMs / 1000) * sampleRate);
  const midDb = (SILENCE_THRESHOLD_DB + VOICE_THRESHOLD_DB) / 2;
  const rms = Math.pow(10, midDb / 20);
  return new Float32Array(numFrames).fill(rms);
}

function setup() {
  const onRecordingComplete = jest.fn();
  const recordingService = new StubAudioRecordingService();
  const encoderService = new StubAudioEncoderService();
  const repository = new StubRecordingsRepository();
  const audioContext = makeStubAudioContext();

  const { result, unmount } = renderHook(() =>
    useVoiceMirror(
      onRecordingComplete,
      audioContext,
      recordingService,
      encoderService,
      repository,
      DEFAULT_SETTINGS,
    ),
  );

  return {
    result,
    unmount,
    onRecordingComplete,
    recordingService,
    encoderService,
    repository,
    audioContext,
  };
}

async function setupWithPermission() {
  const ctx = setup();
  await waitFor(() => expect(ctx.result.current.hasPermission).toBe(true));
  return ctx;
}

function simulateVoiceOnset(
  recordingService: StubAudioRecordingService,
  chunkDurationMs = 100,
) {
  const chunksNeeded = Math.ceil(VOICE_ONSET_MS / chunkDurationMs) + 2;
  for (let i = 0; i < chunksNeeded; i++) {
    jest.advanceTimersByTime(chunkDurationMs);
    recordingService.recorder.simulateChunk(makeLoudChunk(chunkDurationMs));
  }
}

function simulateSilence(
  recordingService: StubAudioRecordingService,
  chunkDurationMs = 100,
) {
  const chunksNeeded = Math.ceil(SILENCE_DURATION_MS / chunkDurationMs) + 2;
  for (let i = 0; i < chunksNeeded; i++) {
    jest.advanceTimersByTime(chunkDurationMs);
    recordingService.recorder.simulateChunk(makeSilentChunk(chunkDurationMs));
  }
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

describe("useVoiceMirror — permissions", () => {
  it("hasPermission is false before the effect runs", () => {
    const { result } = setup();
    expect(result.current.hasPermission).toBe(false);
  });

  it("hasPermission becomes true after permission is granted", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.hasPermission).toBe(true));
  });

  it("permissionDenied becomes true when permission is Denied", async () => {
    const recordingService = new StubAudioRecordingService();
    recordingService.requestRecordingPermissions.mockResolvedValue("Denied");
    const { result } = renderHook(() =>
      useVoiceMirror(
        jest.fn(),
        makeStubAudioContext(),
        recordingService,
        new StubAudioEncoderService(),
        new StubRecordingsRepository(),
        DEFAULT_SETTINGS,
      ),
    );
    await waitFor(() => expect(result.current.permissionDenied).toBe(true));
    expect(result.current.hasPermission).toBe(false);
  });

  it("calls setAudioSessionOptions once after permission is granted", async () => {
    const { recordingService } = await setupWithPermission();
    expect(recordingService.setAudioSessionOptions).toHaveBeenCalledTimes(1);
  });

  it("calls createRecorder once after permission is granted", async () => {
    const { recordingService } = await setupWithPermission();
    expect(recordingService.createRecorder).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Phase: idle → recording
// ---------------------------------------------------------------------------

describe("useVoiceMirror — idle → recording", () => {
  it("stays idle when audio is below voice threshold", async () => {
    const { result, recordingService } = await setupWithPermission();

    act(() => {
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeSilentChunk());
      }
    });

    expect(result.current.phase).toBe("idle");
  });

  it("resets voice onset timer when audio drops below threshold mid-onset", async () => {
    const { result, recordingService } = await setupWithPermission();

    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeLoudChunk());
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeSilentChunk());
      jest.advanceTimersByTime(VOICE_ONSET_MS);
      recordingService.recorder.simulateChunk(makeSilentChunk());
    });

    expect(result.current.phase).toBe("idle");
  });

  it("transitions to recording after sustained voice above threshold", async () => {
    const { result, recordingService } = await setupWithPermission();

    act(() => {
      simulateVoiceOnset(recordingService);
    });

    expect(result.current.phase).toBe("recording");
  });

  it("calls encoderService.startEncoding exactly once when recording begins", async () => {
    const { recordingService, encoderService } = await setupWithPermission();

    act(() => {
      simulateVoiceOnset(recordingService);
    });

    expect(encoderService.startEncoding).toHaveBeenCalledTimes(1);
    expect(encoderService.startEncoding).toHaveBeenCalledWith(
      expect.stringContaining(".m4a"),
      expect.any(Number),
    );
  });

  it("retroactively feeds pre-voice chunks to encodeChunk in beginEncoding", async () => {
    const { recordingService, encoderService } = await setupWithPermission();

    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeLoudChunk());
    });

    act(() => {
      simulateVoiceOnset(recordingService);
    });

    expect(encoderService.encodeChunk).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase: recording → playing
// ---------------------------------------------------------------------------

describe("useVoiceMirror — recording → playing", () => {
  it("transitions to playing after sufficient silence following minimum recording", async () => {
    const { result, recordingService } = await setupWithPermission();

    act(() => {
      simulateVoiceOnset(recordingService);
      const minChunks = Math.ceil(MIN_RECORDING_MS / 100) + 1;
      for (let i = 0; i < minChunks; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk());
      }
      simulateSilence(recordingService);
    });

    await waitFor(() => expect(result.current.phase).toBe("playing"));
  });

  it("does not transition to playing if recording is shorter than MIN_RECORDING_MS", async () => {
    const { result, recordingService } = await setupWithPermission();

    // Use exactly the minimum chunks for onset (4 × 100ms = onset at 300ms elapsed).
    // At onset: voiceStartFrame=4410, totalFrames=17640, speechMs=300ms < MIN_RECORDING_MS.
    // One silent chunk: totalFrames=22050, speechMs=400ms — still below MIN_RECORDING_MS,
    // so the silence condition is blocked by the guard.
    act(() => {
      const minOnsetChunks = Math.ceil(VOICE_ONSET_MS / 100) + 1;
      for (let i = 0; i < minOnsetChunks; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk(100));
      }
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeSilentChunk(100));
    });

    expect(result.current.phase).toBe("recording");
  });

  it("awaits encoderService.stopEncoding when transitioning to playing", async () => {
    const { result, recordingService, encoderService } =
      await setupWithPermission();

    act(() => {
      simulateVoiceOnset(recordingService);
      const minChunks = Math.ceil(MIN_RECORDING_MS / 100) + 1;
      for (let i = 0; i < minChunks; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk());
      }
      simulateSilence(recordingService);
    });

    await waitFor(() => expect(result.current.phase).toBe("playing"));
    expect(encoderService.stopEncoding).toHaveBeenCalledTimes(1);
  });

  it("calls onRecordingComplete with filePath and durationMs when encoding succeeds", async () => {
    const { result, recordingService, encoderService, onRecordingComplete } =
      await setupWithPermission();
    encoderService.stopEncoding.mockResolvedValue(1500);

    act(() => {
      simulateVoiceOnset(recordingService);
      const minChunks = Math.ceil(MIN_RECORDING_MS / 100) + 1;
      for (let i = 0; i < minChunks; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk());
      }
      simulateSilence(recordingService);
    });

    await waitFor(() => expect(result.current.phase).toBe("playing"));
    expect(onRecordingComplete).toHaveBeenCalledWith(
      expect.stringContaining(".m4a"),
      1500,
    );
  });

  it("calls repository.deleteFile and does NOT call onRecordingComplete when stopEncoding returns 0", async () => {
    const {
      result,
      recordingService,
      encoderService,
      repository,
      onRecordingComplete,
    } = await setupWithPermission();
    encoderService.stopEncoding.mockResolvedValue(0);

    act(() => {
      simulateVoiceOnset(recordingService);
      const minChunks = Math.ceil(MIN_RECORDING_MS / 100) + 1;
      for (let i = 0; i < minChunks; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk());
      }
      simulateSilence(recordingService);
    });

    await waitFor(() => expect(result.current.phase).toBe("playing"));
    expect(repository.deleteFile).toHaveBeenCalledTimes(1);
    expect(onRecordingComplete).not.toHaveBeenCalled();
  });

  it("sets recordingError when stopEncoding returns 0", async () => {
    const { result, recordingService, encoderService } =
      await setupWithPermission();
    encoderService.stopEncoding.mockResolvedValue(0);

    act(() => {
      simulateVoiceOnset(recordingService);
      const minChunks = Math.ceil(MIN_RECORDING_MS / 100) + 1;
      for (let i = 0; i < minChunks; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk());
      }
      simulateSilence(recordingService);
    });

    await waitFor(() => expect(result.current.recordingError).not.toBeNull());
    expect(result.current.recordingError).toBe("recording_failed");
  });
});

// ---------------------------------------------------------------------------
// Phase: pause / resume
// ---------------------------------------------------------------------------

describe("useVoiceMirror — pause / resume", () => {
  it("transitions to paused when togglePause is called in idle", async () => {
    const { result } = await setupWithPermission();

    await act(async () => {
      result.current.togglePause();
    });

    expect(result.current.phase).toBe("paused");
  });

  it("calls setAudioSessionActivity(false) when pausing", async () => {
    const { result, recordingService } = await setupWithPermission();

    await act(async () => {
      result.current.togglePause();
    });

    const calls = recordingService.setAudioSessionActivity.mock.calls;
    const pauseCall = calls.find(([arg]) => arg === false);
    expect(pauseCall).toBeDefined();
  });

  it("returns to idle when togglePause is called while paused", async () => {
    const { result } = await setupWithPermission();

    await act(async () => {
      result.current.togglePause();
    });
    expect(result.current.phase).toBe("paused");

    await act(async () => {
      result.current.togglePause();
    });
    expect(result.current.phase).toBe("idle");
  });

  it("zeroes out levelHistory when paused", async () => {
    const { result, recordingService } = await setupWithPermission();

    act(() => {
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk());
      }
    });

    await act(async () => {
      result.current.togglePause();
    });

    expect(result.current.levelHistory).toHaveLength(LEVEL_HISTORY_SIZE);
    expect(result.current.levelHistory.every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pause during recording cleanup
// ---------------------------------------------------------------------------

describe("useVoiceMirror — pause during recording cleanup", () => {
  it("calls stopEncoding and deleteFile when paused during recording", async () => {
    const { result, recordingService, encoderService, repository } =
      await setupWithPermission();

    act(() => {
      simulateVoiceOnset(recordingService);
    });
    expect(result.current.phase).toBe("recording");

    await act(async () => {
      result.current.togglePause();
    });

    expect(result.current.phase).toBe("paused");
    expect(encoderService.stopEncoding).toHaveBeenCalledTimes(1);
    expect(repository.deleteFile).toHaveBeenCalledTimes(1);
    expect(repository.deleteFile).toHaveBeenCalledWith(
      expect.stringContaining(".m4a"),
    );
  });

  it("skips stopEncoding but still deletes file when encoder had failed", async () => {
    const { result, recordingService, encoderService, repository } =
      await setupWithPermission();

    act(() => {
      simulateVoiceOnset(recordingService);
    });
    expect(result.current.phase).toBe("recording");

    // Make encodeChunk fail so encoderFailedRef becomes true
    encoderService.encodeChunk.mockImplementation(() => {
      throw new Error("encode failed");
    });

    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeLoudChunk());
    });

    // Reset mock to track only pause-related calls
    encoderService.stopEncoding.mockClear();

    await act(async () => {
      result.current.togglePause();
    });

    expect(result.current.phase).toBe("paused");
    expect(encoderService.stopEncoding).not.toHaveBeenCalled();
    expect(repository.deleteFile).toHaveBeenCalledTimes(1);
  });

  it("does not call stopEncoding or deleteFile when paused from idle", async () => {
    const { result, encoderService, repository } = await setupWithPermission();

    expect(result.current.phase).toBe("idle");

    await act(async () => {
      result.current.togglePause();
    });

    expect(result.current.phase).toBe("paused");
    expect(encoderService.stopEncoding).not.toHaveBeenCalled();
    expect(repository.deleteFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// List playback coordination
// ---------------------------------------------------------------------------

describe("useVoiceMirror — list playback coordination", () => {
  it("suspendForListPlayback stops the recorder and sets phase to idle", async () => {
    const { result, recordingService } = await setupWithPermission();

    await act(async () => {
      await result.current.suspendForListPlayback();
    });

    expect(recordingService.recorder.stop).toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("resumeFromListPlayback restarts monitoring when not user-paused", async () => {
    const { result, recordingService } = await setupWithPermission();

    const startCallsBefore = recordingService.recorder.start.mock.calls.length;

    await act(async () => {
      await result.current.suspendForListPlayback();
    });
    await act(async () => {
      await result.current.resumeFromListPlayback();
    });

    expect(recordingService.recorder.start.mock.calls.length).toBeGreaterThan(
      startCallsBefore,
    );
    expect(result.current.phase).toBe("idle");
  });

  it("resumeFromListPlayback stays paused when user had explicitly paused before list playback", async () => {
    const { result } = await setupWithPermission();

    await act(async () => {
      result.current.togglePause();
    });
    expect(result.current.phase).toBe("paused");

    await act(async () => {
      await result.current.suspendForListPlayback();
    });
    await act(async () => {
      await result.current.resumeFromListPlayback();
    });

    expect(result.current.phase).toBe("paused");
  });
});

// ---------------------------------------------------------------------------
// Recording timeout
// ---------------------------------------------------------------------------

describe("useVoiceMirror — recording timeout", () => {
  it("transitions to playing when speechMs exceeds maxRecordingMs", async () => {
    const onRecordingComplete = jest.fn();
    const recordingService = new StubAudioRecordingService();
    const encoderService = new StubAudioEncoderService();
    const repository = new StubRecordingsRepository();
    const audioContext = makeStubAudioContext();

    const { result } = renderHook(() =>
      useVoiceMirror(
        onRecordingComplete,
        audioContext,
        recordingService,
        encoderService,
        repository,
        { ...DEFAULT_SETTINGS, maxRecordingMs: 2000 },
      ),
    );

    await waitFor(() => expect(result.current.hasPermission).toBe(true));

    act(() => {
      simulateVoiceOnset(recordingService);

      const chunkMs = 100;
      const chunksNeeded = Math.ceil(2000 / chunkMs) + 2;
      for (let i = 0; i < chunksNeeded; i++) {
        jest.advanceTimersByTime(chunkMs);
        recordingService.recorder.simulateChunk(makeLoudChunk(chunkMs));
      }
    });

    await waitFor(() => expect(result.current.phase).toBe("playing"));
  });

  it("does not timeout when maxRecordingMs is 0 (unlimited)", async () => {
    const onRecordingComplete = jest.fn();
    const recordingService = new StubAudioRecordingService();
    const encoderService = new StubAudioEncoderService();
    const repository = new StubRecordingsRepository();
    const audioContext = makeStubAudioContext();

    const { result } = renderHook(() =>
      useVoiceMirror(
        onRecordingComplete,
        audioContext,
        recordingService,
        encoderService,
        repository,
        { ...DEFAULT_SETTINGS, maxRecordingMs: 0 },
      ),
    );

    await waitFor(() => expect(result.current.hasPermission).toBe(true));

    act(() => {
      simulateVoiceOnset(recordingService);

      const chunkMs = 100;
      const chunksNeeded = Math.ceil(5000 / chunkMs);
      for (let i = 0; i < chunksNeeded; i++) {
        jest.advanceTimersByTime(chunkMs);
        recordingService.recorder.simulateChunk(makeLoudChunk(chunkMs));
      }
    });

    expect(result.current.phase).toBe("recording");
  });

  it("calls onRecordingComplete when timeout triggers with valid encoding", async () => {
    const onRecordingComplete = jest.fn();
    const recordingService = new StubAudioRecordingService();
    const encoderService = new StubAudioEncoderService();
    const repository = new StubRecordingsRepository();
    const audioContext = makeStubAudioContext();
    encoderService.stopEncoding.mockResolvedValue(2000);

    const { result } = renderHook(() =>
      useVoiceMirror(
        onRecordingComplete,
        audioContext,
        recordingService,
        encoderService,
        repository,
        { ...DEFAULT_SETTINGS, maxRecordingMs: 2000 },
      ),
    );

    await waitFor(() => expect(result.current.hasPermission).toBe(true));

    act(() => {
      simulateVoiceOnset(recordingService);

      const chunkMs = 100;
      const chunksNeeded = Math.ceil(2000 / chunkMs) + 2;
      for (let i = 0; i < chunksNeeded; i++) {
        jest.advanceTimersByTime(chunkMs);
        recordingService.recorder.simulateChunk(makeLoudChunk(chunkMs));
      }
    });

    await waitFor(() => expect(result.current.phase).toBe("playing"));
    expect(onRecordingComplete).toHaveBeenCalledWith(
      expect.stringContaining(".m4a"),
      2000,
    );
  });
});

// ---------------------------------------------------------------------------
// Pre-roll
// ---------------------------------------------------------------------------

describe("useVoiceMirror — pre-roll", () => {
  it("includes pre-roll audio before voice detection point in encoding", async () => {
    const { recordingService, encoderService } = await setupWithPermission();

    act(() => {
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeSilentChunk());
      }
    });

    act(() => {
      simulateVoiceOnset(recordingService);
    });

    const totalEncodedFrames = encoderService.encodeChunk.mock.calls.reduce(
      (sum: number, [chunk]: [Float32Array]) => sum + chunk.length,
      0,
    );

    const voiceOnsetFrames = Math.round((VOICE_ONSET_MS / 1000) * 44100);
    expect(totalEncodedFrames).toBeGreaterThan(voiceOnsetFrames);
  });

  it("clamps pre-roll to buffer start when buffer is very short", async () => {
    const { recordingService, encoderService } = await setupWithPermission();

    act(() => {
      simulateVoiceOnset(recordingService);
    });

    expect(encoderService.startEncoding).toHaveBeenCalledTimes(1);
    expect(encoderService.encodeChunk).toHaveBeenCalled();
  });

  it("bridges brief intra-word silence gaps to capture plosive onsets like 'kitto'", async () => {
    const { recordingService, encoderService } = await setupWithPermission();

    // Background silence (sustained)
    act(() => {
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeSilentChunk());
      }
    });

    // Brief plosive burst ("ki") - above voice threshold but too short for onset
    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeLoudChunk());
    });

    // Intra-word silence gap (geminate consonant "っ") - 1 chunk, below gap tolerance
    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeSilentChunk());
    });

    // Sustained voice ("tto") - triggers voice onset detection
    act(() => {
      simulateVoiceOnset(recordingService);
    });

    const totalEncodedFrames = encoderService.encodeChunk.mock.calls.reduce(
      (sum: number, [chunk]: [Float32Array]) => sum + chunk.length,
      0,
    );

    // The encoded audio should include the "ki" burst and the gap,
    // not just the voice onset portion.
    const voiceOnsetFrames = Math.round((VOICE_ONSET_MS / 1000) * 44100);
    const burstAndGapFrames = 2 * Math.round((100 / 1000) * 44100);
    expect(totalEncodedFrames).toBeGreaterThan(
      voiceOnsetFrames + burstAndGapFrames,
    );
  });

  it("does not bridge silence gaps longer than the gap tolerance", async () => {
    const { recordingService, encoderService } = await setupWithPermission();

    // Background silence
    act(() => {
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeSilentChunk());
      }
    });

    // A loud burst (some noise or false start)
    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeLoudChunk());
    });

    // Long silence gap (3 chunks = 300ms, exceeds 200ms gap tolerance)
    act(() => {
      for (let i = 0; i < 3; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeSilentChunk());
      }
    });

    // Voice onset
    act(() => {
      simulateVoiceOnset(recordingService);
    });

    const totalEncodedFrames = encoderService.encodeChunk.mock.calls.reduce(
      (sum: number, [chunk]: [Float32Array]) => sum + chunk.length,
      0,
    );

    // The loud burst before the long gap should NOT be included.
    const voiceOnsetFrames = Math.round((VOICE_ONSET_MS / 1000) * 44100);
    const burstAndGapFrames =
      Math.round((100 / 1000) * 44100) + 3 * Math.round((100 / 1000) * 44100);
    expect(totalEncodedFrames).toBeLessThan(
      voiceOnsetFrames + burstAndGapFrames,
    );
  });

  it("captures gradual speech attack by scanning backward to silence threshold", async () => {
    const { recordingService, encoderService } = await setupWithPermission();

    act(() => {
      for (let i = 0; i < 3; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeSilentChunk());
      }
    });

    act(() => {
      for (let i = 0; i < 3; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeRisingChunk());
      }
    });

    act(() => {
      simulateVoiceOnset(recordingService);
    });

    const totalEncodedFrames = encoderService.encodeChunk.mock.calls.reduce(
      (sum: number, [chunk]: [Float32Array]) => sum + chunk.length,
      0,
    );

    const voiceOnsetFrames = Math.round((VOICE_ONSET_MS / 1000) * 44100);
    const risingFrames = 3 * Math.round((100 / 1000) * 44100);
    expect(totalEncodedFrames).toBeGreaterThan(voiceOnsetFrames + risingFrames);
  });
});

// ---------------------------------------------------------------------------
// currentDb state
// ---------------------------------------------------------------------------

describe("useVoiceMirror — currentDb", () => {
  it("updates currentDb on audio chunk during idle phase", async () => {
    const { result, recordingService } = await setupWithPermission();

    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeLoudChunk());
    });

    expect(result.current.currentDb).not.toBeNull();
    expect(typeof result.current.currentDb).toBe("number");
  });

  it("updates currentDb on audio chunk during recording phase", async () => {
    const { result, recordingService } = await setupWithPermission();

    act(() => {
      simulateVoiceOnset(recordingService);
    });
    expect(result.current.phase).toBe("recording");

    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeLoudChunk());
    });

    expect(result.current.currentDb).not.toBeNull();
  });

  it("resets currentDb to null when pausing", async () => {
    const { result, recordingService } = await setupWithPermission();

    act(() => {
      jest.advanceTimersByTime(100);
      recordingService.recorder.simulateChunk(makeLoudChunk());
    });
    expect(result.current.currentDb).not.toBeNull();

    await act(async () => {
      result.current.togglePause();
    });
    expect(result.current.currentDb).toBeNull();
  });

  it("resets currentDb to null when transitioning to playback", async () => {
    const { result, recordingService } = await setupWithPermission();

    act(() => {
      simulateVoiceOnset(recordingService);
      const minChunks = Math.ceil(MIN_RECORDING_MS / 100) + 1;
      for (let i = 0; i < minChunks; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk());
      }
      simulateSilence(recordingService);
    });

    await waitFor(() => expect(result.current.phase).toBe("playing"));
    expect(result.current.currentDb).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Level history during playback
// ---------------------------------------------------------------------------

describe("useVoiceMirror — level history during playback", () => {
  it("levelHistory updates during the playing phase", async () => {
    const { result, recordingService, audioContext } =
      await setupWithPermission();

    // Make createBuffer return a buffer with loud audio data
    const loudData = new Float32Array(44100).fill(0.5);
    const stubBuffer = {
      length: 44100,
      duration: 1,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: jest.fn(() => loudData),
      copyFromChannel: jest.fn(),
      copyToChannel: jest.fn(),
    };
    (audioContext.createBuffer as jest.Mock).mockReturnValue(stubBuffer);

    const stubSource = makeStubBufferSourceNode();
    (audioContext.createBufferSource as jest.Mock).mockReturnValue(stubSource);

    act(() => {
      simulateVoiceOnset(recordingService);
      const minChunks = Math.ceil(MIN_RECORDING_MS / 100) + 1;
      for (let i = 0; i < minChunks; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk());
      }
      simulateSilence(recordingService);
    });

    await waitFor(() => expect(result.current.phase).toBe("playing"));

    // Advance timers to trigger playback level ticks
    act(() => {
      jest.advanceTimersByTime(93 * 3);
    });

    const hasNonZero = result.current.levelHistory.some((v) => v > 0);
    expect(hasNonZero).toBe(true);
  });

  it("levelHistory stops updating after playback ends", async () => {
    const { result, recordingService, audioContext } =
      await setupWithPermission();

    const loudData = new Float32Array(44100).fill(0.5);
    const stubBuffer = {
      length: 44100,
      duration: 1,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: jest.fn(() => loudData),
      copyFromChannel: jest.fn(),
      copyToChannel: jest.fn(),
    };
    (audioContext.createBuffer as jest.Mock).mockReturnValue(stubBuffer);

    const stubSource = makeStubBufferSourceNode();
    (audioContext.createBufferSource as jest.Mock).mockReturnValue(stubSource);

    act(() => {
      simulateVoiceOnset(recordingService);
      const minChunks = Math.ceil(MIN_RECORDING_MS / 100) + 1;
      for (let i = 0; i < minChunks; i++) {
        jest.advanceTimersByTime(100);
        recordingService.recorder.simulateChunk(makeLoudChunk());
      }
      simulateSilence(recordingService);
    });

    await waitFor(() => expect(result.current.phase).toBe("playing"));

    // Trigger onEnded to simulate playback ending
    act(() => {
      stubSource.onEnded?.();
    });

    // Advance timers - should not produce further playback level updates
    act(() => {
      jest.advanceTimersByTime(93 * 5);
    });

    // Phase should be idle now (startMonitoring resets)
    await waitFor(() => expect(result.current.phase).toBe("idle"));
  });
});
