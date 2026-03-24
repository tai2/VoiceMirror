import { Platform } from "react-native";
import type {
  IAudioRecordingService,
  IAudioRecorder,
  AudioChunkEvent,
} from "./AudioRecordingService";
import type {
  AudioRecorderCallbackOptions,
  PermissionStatus,
  SessionOptions,
} from "react-native-audio-api";

const WS_HOST = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
const WS_PORT = 9876;

const RECONNECT_DELAY_MS = 500;
const CONNECTION_TIMEOUT_MS = 3000;

export type E2EConnectionStatus = "disconnected" | "connecting" | "connected";

class E2EAudioRecorder implements IAudioRecorder {
  private ws: WebSocket | null = null;
  private callback: ((event: AudioChunkEvent) => void) | null = null;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectAttempts = 0;
  private onStatusChange: (status: E2EConnectionStatus) => void;

  constructor(onStatusChange: (status: E2EConnectionStatus) => void) {
    this.onStatusChange = onStatusChange;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    this.onStatusChange("connecting");

    const url = `ws://${WS_HOST}:${WS_PORT}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    // Force reconnect if onerror/onclose don't fire in Hermes release builds
    // (handles both stuck-CONNECTING and silent-CLOSED cases)
    this.connectAttempts++;

    const connectionTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        if (this.ws === ws) this.ws = null;
        scheduleReconnect();
      }
    }, CONNECTION_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(connectionTimer);
      this.onStatusChange("connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!this.callback) return;
      const { data } = event as { data: unknown };
      let buffer: ArrayBuffer;
      if (data instanceof ArrayBuffer) {
        buffer = data;
      } else if (typeof data === "string") {
        // Android release mode: binary messages may arrive as base64 strings
        const decoded = atob(data);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
          bytes[i] = decoded.charCodeAt(i);
        }
        buffer = bytes.buffer;
      } else {
        return;
      }
      const samples = new Float32Array(buffer);
      this.callback({ chunk: samples, numFrames: samples.length });
    };

    const scheduleReconnect = () => {
      if (!this.stopped && this.reconnectTimer === null) {
        this.onStatusChange("disconnected");
        console.warn("[E2EAudioRecorder] scheduling reconnect");
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          RECONNECT_DELAY_MS,
        );
      }
    };

    ws.onerror = () => {
      clearTimeout(connectionTimer);
      scheduleReconnect();
    };
    ws.onclose = () => {
      clearTimeout(connectionTimer);
      scheduleReconnect();
    };
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.onStatusChange("disconnected");
  }

  onAudioReady(
    _config: AudioRecorderCallbackOptions,
    callback: (event: AudioChunkEvent) => void,
  ): void {
    this.callback = callback;
  }

  clearOnAudioReady(): void {
    this.callback = null;
  }
}

type StatusListener = () => void;

export class E2EAudioRecordingService implements IAudioRecordingService {
  private _connectionStatus: E2EConnectionStatus = "disconnected";
  private listeners = new Set<StatusListener>();

  requestRecordingPermissions(): Promise<PermissionStatus> {
    return Promise.resolve("Granted" as PermissionStatus);
  }

  setAudioSessionOptions(_options: SessionOptions): void {}

  setAudioSessionActivity(_active: boolean): Promise<void> {
    return Promise.resolve();
  }

  createRecorder(): IAudioRecorder {
    return new E2EAudioRecorder((status) => {
      this._connectionStatus = status;
      this.listeners.forEach((l) => l());
    });
  }

  /** useSyncExternalStore-compatible subscribe */
  subscribe = (listener: StatusListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): E2EConnectionStatus => {
    return this._connectionStatus;
  };
}
