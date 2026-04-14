import type {
  IAudioRecordingService,
  IAudioRecorder,
  AudioChunkEvent,
} from "../../services/AudioRecordingService";
import type {
  AudioRecorderCallbackOptions,
  PermissionStatus,
  SessionOptions,
} from "react-native-audio-api";

export class StubAudioRecorder implements IAudioRecorder {
  private callback: ((event: AudioChunkEvent) => void) | null = null;

  start = jest.fn();
  stop = jest.fn();
  clearOnAudioReady = jest.fn(() => {
    this.callback = null;
  });

  onAudioReady(
    _config: AudioRecorderCallbackOptions,
    callback: (event: AudioChunkEvent) => void,
  ): void {
    this.callback = callback;
  }

  simulateChunk(chunk: Float32Array): void {
    this.callback?.({ chunk, numFrames: chunk.length });
  }
}

export class StubAudioRecordingService implements IAudioRecordingService {
  readonly recorder = new StubAudioRecorder();

  requestRecordingPermissions: jest.Mock<Promise<PermissionStatus>> = jest
    .fn()
    .mockResolvedValue("Granted" as PermissionStatus);
  setAudioSessionOptions: jest.Mock<void, [SessionOptions]> = jest.fn();
  setAudioSessionActivity: jest.Mock<Promise<void>, [boolean]> = jest
    .fn()
    .mockResolvedValue(undefined);
  createRecorder: jest.Mock<IAudioRecorder> = jest.fn(() => this.recorder);
}
