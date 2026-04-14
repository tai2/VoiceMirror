import { renderHook, act } from "@testing-library/react-native";
import { usePlaybackLevelHistory } from "../usePlaybackLevelHistory";
import { makeStubAudioBuffer } from "../../__tests__/stubs/stubAudioDecoderService";
import { LEVEL_HISTORY_SIZE } from "../../constants/audio";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function makeLoudAudioBuffer(length = 44100, sampleRate = 44100) {
  const buffer = makeStubAudioBuffer(length, sampleRate);
  const data = new Float32Array(length).fill(0.5);
  (buffer.getChannelData as jest.Mock).mockReturnValue(data);
  return buffer;
}

describe("usePlaybackLevelHistory", () => {
  it("startPlaybackLevels begins pushing values into levelHistory via the setter", () => {
    const { result } = renderHook(() => usePlaybackLevelHistory());
    const history: number[] = new Array(LEVEL_HISTORY_SIZE).fill(0);
    const setLevelHistory = jest.fn((updater: (prev: number[]) => number[]) => {
      const next = updater(history);
      history.length = 0;
      history.push(...next);
    });

    act(() => {
      result.current.startPlaybackLevels(
        makeLoudAudioBuffer(),
        0,
        setLevelHistory,
      );
    });

    // Initial reset call
    expect(setLevelHistory).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(93);
    });

    expect(setLevelHistory).toHaveBeenCalledTimes(2);
    expect(history[history.length - 1]).toBeGreaterThan(0);
  });

  it("stopPlaybackLevels stops the timer (no further updates)", () => {
    const { result } = renderHook(() => usePlaybackLevelHistory());
    const setLevelHistory = jest.fn();

    act(() => {
      result.current.startPlaybackLevels(
        makeLoudAudioBuffer(),
        0,
        setLevelHistory,
      );
    });

    act(() => {
      jest.advanceTimersByTime(93);
    });
    const callCountAfterOneTick = setLevelHistory.mock.calls.length;

    act(() => {
      result.current.stopPlaybackLevels();
    });
    act(() => {
      jest.advanceTimersByTime(93 * 5);
    });

    expect(setLevelHistory).toHaveBeenCalledTimes(callCountAfterOneTick);
  });

  it("calling startPlaybackLevels twice stops the first timer before starting a new one", () => {
    const { result } = renderHook(() => usePlaybackLevelHistory());
    const setLevelHistory1 = jest.fn();
    const setLevelHistory2 = jest.fn();

    act(() => {
      result.current.startPlaybackLevels(
        makeLoudAudioBuffer(),
        0,
        setLevelHistory1,
      );
    });

    act(() => {
      jest.advanceTimersByTime(93);
    });
    const callsAfterFirstTick = setLevelHistory1.mock.calls.length;

    act(() => {
      result.current.startPlaybackLevels(
        makeLoudAudioBuffer(),
        0,
        setLevelHistory2,
      );
    });

    act(() => {
      jest.advanceTimersByTime(93);
    });

    // First setter should not have been called again after second start
    expect(setLevelHistory1).toHaveBeenCalledTimes(callsAfterFirstTick);
    // Second setter should have been called (initial reset + tick)
    expect(setLevelHistory2.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("auto-stops when reaching the end of the audio buffer", () => {
    const shortBuffer = makeLoudAudioBuffer(4096, 44100); // ~93ms of audio
    const { result } = renderHook(() => usePlaybackLevelHistory());
    const setLevelHistory = jest.fn();

    act(() => {
      result.current.startPlaybackLevels(shortBuffer, 0, setLevelHistory);
    });

    // Advance well past the buffer duration
    act(() => {
      jest.advanceTimersByTime(93 * 10);
    });

    const callCount = setLevelHistory.mock.calls.length;

    // Further ticks should produce no additional calls
    act(() => {
      jest.advanceTimersByTime(93 * 5);
    });
    expect(setLevelHistory).toHaveBeenCalledTimes(callCount);
  });
});
