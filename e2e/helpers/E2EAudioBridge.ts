import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import {
  SAMPLE_RATE,
  VOICE_THRESHOLD_DB,
  SILENCE_THRESHOLD_DB,
} from "../../src/constants/audio";

const CHUNK_FRAMES = 4096;
const CHUNK_DURATION_MS = (CHUNK_FRAMES / SAMPLE_RATE) * 1000;

function dbToAmplitude(targetDb: number): number {
  const rms = Math.pow(10, targetDb / 20);
  return rms * Math.sqrt(2);
}

function makeNoiseChunk(amplitude: number): Float32Array {
  const samples = new Float32Array(CHUNK_FRAMES);
  for (let i = 0; i < CHUNK_FRAMES; i++) {
    samples[i] = amplitude * (Math.random() * 2 - 1);
  }
  return samples;
}

export class E2EAudioBridge {
  private readonly httpServer: ReturnType<typeof createServer>;
  private readonly wss: WebSocketServer;
  private client: WebSocket | null = null;

  constructor(readonly port: number = 9876) {
    this.httpServer = createServer((req, res) => {
      console.log(
        `[E2EAudioBridge] HTTP request: ${req.method} ${req.url} from ${req.socket.remoteAddress}`,
      );
      res.writeHead(200);
      res.end("ok");
    });
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.httpServer.listen(port, "0.0.0.0", () => {
      console.log(`[E2EAudioBridge] listening on 0.0.0.0:${port}`);
    });
    this.wss.on("connection", (ws, req) => {
      console.log(
        `[E2EAudioBridge] client connected from ${req.socket.remoteAddress}`,
      );
      this.client = ws;
      ws.on("close", () => {
        console.log("[E2EAudioBridge] client disconnected");
        this.client = null;
      });
    });
    this.wss.on("error", (e) => {
      console.error("[E2EAudioBridge] server error:", e.message);
    });
  }

  async waitForConnection(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.client) {
      if (Date.now() > deadline) {
        throw new Error("E2EAudioBridge: timed out waiting for app connection");
      }
      await new Promise<void>((r) => setTimeout(r, 100));
    }
  }

  async sendVoice(durationMs: number, overrideDb?: number): Promise<void> {
    const db = overrideDb ?? VOICE_THRESHOLD_DB + 10;
    await this.sendChunks(durationMs, db);
  }

  async sendSilence(durationMs: number, overrideDb?: number): Promise<void> {
    const db = overrideDb ?? SILENCE_THRESHOLD_DB - 10;
    await this.sendChunks(durationMs, db);
  }

  // WS is disconnected when AudioRecorder is stopped. Don't attempt to send chunks when you supposed AudioRecorder to
  // be stopped.
  private async sendChunks(
    durationMs: number,
    targetDb: number,
  ): Promise<void> {
    await this.waitForConnection();
    const numChunks = Math.ceil(durationMs / CHUNK_DURATION_MS);
    const amplitude = dbToAmplitude(targetDb);
    for (let i = 0; i < numChunks; i++) {
      this.sendChunk(makeNoiseChunk(amplitude));
      await new Promise<void>((r) => setTimeout(r, CHUNK_DURATION_MS));
    }
  }

  private sendChunk(samples: Float32Array): void {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      return;
    }
    this.client.send(Buffer.from(samples.buffer));
  }

  async close(): Promise<void> {
    if (this.client) {
      this.client.terminate();
      this.client = null;
    }
    return new Promise<void>((resolve) => {
      this.wss.close(() => {
        this.httpServer.close(() => resolve());
      });
    });
  }
}
