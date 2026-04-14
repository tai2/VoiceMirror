import { AudioManager, AudioRecorder } from "react-native-audio-api";
import type {
  PermissionStatus,
  SessionOptions,
  AudioRecorderCallbackOptions,
} from "react-native-audio-api";

export type AudioChunkEvent = {
  chunk: Float32Array;
  numFrames: number;
};

export interface IAudioRecorder {
  start(): void;
  stop(): void;
  onAudioReady(
    config: AudioRecorderCallbackOptions,
    callback: (event: AudioChunkEvent) => void,
  ): void;
  clearOnAudioReady(): void;
}

export interface IAudioRecordingService {
  requestRecordingPermissions(): Promise<PermissionStatus>;
  setAudioSessionOptions(options: SessionOptions): void;
  setAudioSessionActivity(active: boolean): Promise<void>;
  createRecorder(): IAudioRecorder;
}

class RealAudioRecorder implements IAudioRecorder {
  private readonly recorder: AudioRecorder;

  constructor() {
    this.recorder = new AudioRecorder();
  }

  start(): void {
    this.recorder.start();
  }

  stop(): void {
    this.recorder.stop();
  }

  clearOnAudioReady(): void {
    this.recorder.clearOnAudioReady();
  }

  onAudioReady(
    config: AudioRecorderCallbackOptions,
    callback: (event: AudioChunkEvent) => void,
  ): void {
    this.recorder.onAudioReady(config, ({ buffer, numFrames }) => {
      const chunk = new Float32Array(numFrames);
      buffer.copyFromChannel(chunk, 0);
      callback({ chunk, numFrames });
    });
  }
}

export class RealAudioRecordingService implements IAudioRecordingService {
  requestRecordingPermissions(): Promise<PermissionStatus> {
    return AudioManager.requestRecordingPermissions();
  }

  setAudioSessionOptions(options: SessionOptions): void {
    AudioManager.setAudioSessionOptions(options);
  }

  async setAudioSessionActivity(active: boolean): Promise<void> {
    await AudioManager.setAudioSessionActivity(active);
  }

  createRecorder(): IAudioRecorder {
    return new RealAudioRecorder();
  }
}
