# Record Voices to File — Implementation Plan

*2026-03-19*

---

## 1. Goal

Every recording that completes (silence detected after speech) is encoded to an `.m4a` file on disk. The main screen shows the session's recordings as a scrollable list below the existing voice-mirror UI. Each item shows the recorded date/time and duration, and a play button lets the user hear any past take.

---

## 2. High-Level Architecture

```
[Microphone]
    │
    ▼
onAudioReady callback (~93 ms chunks, Float32)
    │
    ├─ [idle]       → rolling-window buffer (unchanged)
    │
    ├─ [recording]  → feed chunk to AudioEncoder native module
    │                  (first call replays pre-onset buffer)
    │
    └─ [silence]    → AudioEncoder.stopEncoding()
                        → { filePath, durationMs }
                        → append to recordings store
                        → existing in-memory playback (unchanged)

[Recordings list]
    │
    └─ tap ▶  → createAudioPlayer(filePath) → player.play()
```

The in-memory playback loop (`AudioBufferSourceNode`) is **not changed**. The encoder runs in parallel during the `recording` phase and produces a file as a side effect.

---

## 3. New Dependencies

```bash
pnpm add expo-audio expo-file-system
```

| Package | Purpose |
|---------|---------|
| `expo-audio` | Playback of `.m4a` files in the recordings list |
| `expo-file-system` | Manage the `recordings/` directory; list/delete files |

A new **local Expo Module** (`modules/audio-encoder`) provides the native encoding pipeline (iOS: ExtAudioFile / AudioToolbox; Android: MediaCodec + MediaMuxer). See §4.

---

## 4. Native Module: `modules/audio-encoder`

### 4.1 Directory Structure

```
modules/audio-encoder/
├── package.json
├── index.ts
├── src/
│   └── AudioEncoderModule.ts
├── expo-module.config.json
├── ios/
│   └── AudioEncoderModule.swift
└── android/
    └── AudioEncoderModule.kt
```

### 4.2 `package.json`

```json
{
  "name": "audio-encoder",
  "version": "1.0.0",
  "main": "index.ts",
  "expo": {
    "autolinking": {
      "ios": {},
      "android": {
        "sourceDir": "./android"
      }
    }
  }
}
```

Add to **root** `package.json` dependencies:

```json
"audio-encoder": "file:./modules/audio-encoder"
```

Run `pnpm install`, then rebuild native: `expo run:ios` / `expo run:android`.

### 4.3 `expo-module.config.json`

Links AudioToolbox on iOS (no extra build config needed for Android system codecs):

```json
{
  "ios": {
    "frameworks": ["AudioToolbox"]
  }
}
```

### 4.4 TypeScript Interface (`src/AudioEncoderModule.ts`)

```typescript
import { requireNativeModule } from 'expo-modules-core';

interface AudioEncoderNativeModule {
  /**
   * Open an M4A file for streaming encode.
   * Must be called before encodeChunk / stopEncoding.
   * @param filePath Absolute path (file:// URI without scheme, or raw path).
   * @param sampleRate e.g. 44100
   */
  startEncoding(filePath: string, sampleRate: number): void;

  /**
   * Feed a Float32 PCM chunk into the encoder.
   * Fire-and-forget — the Promise resolves when the chunk is accepted,
   * not necessarily when it is fully encoded.
   */
  encodeChunk(samples: Float32Array): Promise<void>;

  /**
   * Flush and close the encoder.
   * Resolves once the file is finalized and readable.
   * @returns duration of the encoded audio in milliseconds
   */
  stopEncoding(): Promise<number>;
}

export default requireNativeModule<AudioEncoderNativeModule>('AudioEncoder');
```

`index.ts` re-exports:

```typescript
export { default } from './src/AudioEncoderModule';
```

### 4.5 iOS — `AudioEncoderModule.swift`

Uses **ExtAudioFile** from AudioToolbox. A dedicated serial `DispatchQueue` serializes all writes so chunks are encoded in order even though `AsyncFunction` uses a thread pool.

```swift
import ExpoModulesCore
import AudioToolbox

public class AudioEncoderModule: Module {
  private var extFile: ExtAudioFileRef?
  private let encoderQueue = DispatchQueue(label: "net.tai2.voicemirror.encoder", qos: .userInitiated)
  private var sampleCount: Int64 = 0
  private var encoderSampleRate: Double = 44100.0

  public func definition() -> ModuleDefinition {
    Name("AudioEncoder")

    // Synchronous: just opens the file (fast, no I/O yet)
    Function("startEncoding") { (filePath: String, sampleRate: Double) in
      self.encoderSampleRate = sampleRate
      self.sampleCount = 0

      var outputFormat = AudioStreamBasicDescription(
        mSampleRate: sampleRate,
        mFormatID: kAudioFormatMPEG4AAC,
        mFormatFlags: 0,
        mBytesPerPacket: 0,
        mFramesPerPacket: 1024,
        mBytesPerFrame: 0,
        mChannelsPerFrame: 1,
        mBitsPerChannel: 0,
        mReserved: 0
      )

      let url = URL(fileURLWithPath: filePath) as CFURL
      var ref: ExtAudioFileRef?
      let createErr = ExtAudioFileCreateWithURL(
        url,
        kAudioFileM4AType,
        &outputFormat,
        nil,
        AudioFileFlags.eraseFile.rawValue,
        &ref
      )
      guard createErr == noErr, let file = ref else {
        throw EncoderException("ExtAudioFileCreateWithURL failed: \(createErr)")
      }

      var clientFormat = AudioStreamBasicDescription(
        mSampleRate: sampleRate,
        mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagsNativeEndian,
        mBytesPerPacket: 4,
        mFramesPerPacket: 1,
        mBytesPerFrame: 4,
        mChannelsPerFrame: 1,
        mBitsPerChannel: 32,
        mReserved: 0
      )
      let propErr = ExtAudioFileSetProperty(
        file,
        kExtAudioFileProperty_ClientDataFormat,
        UInt32(MemoryLayout<AudioStreamBasicDescription>.size),
        &clientFormat
      )
      guard propErr == noErr else {
        ExtAudioFileDispose(file)
        throw EncoderException("SetProperty ClientDataFormat failed: \(propErr)")
      }

      self.extFile = file
    }

    // Async: dispatched to serial queue so chunks are written in order
    AsyncFunction("encodeChunk") { (samples: TypedArray) in
      guard samples.kind == .float32 else {
        throw EncoderException("Expected Float32Array")
      }
      let frameCount = UInt32(samples.length)
      // Copy data out before handing off (TypedArray memory may move after this call returns)
      let floats = samples.toFloat32Array()
      self.encoderQueue.sync {
        guard let file = self.extFile else { return }
        floats.withUnsafeBufferPointer { ptr in
          var bufferList = AudioBufferList(
            mNumberBuffers: 1,
            mBuffers: AudioBuffer(
              mNumberChannels: 1,
              mDataByteSize: frameCount * 4,
              mData: UnsafeMutableRawPointer(mutating: ptr.baseAddress!)
            )
          )
          ExtAudioFileWrite(file, frameCount, &bufferList)
        }
        self.sampleCount += Int64(frameCount)
      }
    }

    // Async: flushes encoder, closes file, returns duration in ms
    AsyncFunction("stopEncoding") { () -> Double in
      return try await withCheckedThrowingContinuation { continuation in
        self.encoderQueue.async {
          guard let file = self.extFile else {
            continuation.resume(throwing: EncoderException("No encoder open"))
            return
          }
          let err = ExtAudioFileDispose(file)  // flushes AAC codec + writes moov atom
          self.extFile = nil
          if err != noErr {
            continuation.resume(throwing: EncoderException("ExtAudioFileDispose failed: \(err)"))
          } else {
            let durationMs = Double(self.sampleCount) / self.encoderSampleRate * 1000.0
            continuation.resume(returning: durationMs)
          }
        }
      }
    }
  }
}

class EncoderException: Exception {
  private let msg: String
  init(_ msg: String) { self.msg = msg }
  override var reason: String { msg }
}
```

### 4.6 Android — `AudioEncoderModule.kt`

Uses **MediaCodec** (AAC encoder) + **MediaMuxer** (M4A container). A single-threaded coroutine dispatcher ensures serial chunk processing.

```kotlin
package expo.modules.audioencoder

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.TypedArray
import expo.modules.kotlin.typedarray.Float32Array as ExpoFloat32Array
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors

class AudioEncoderModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  private val dispatcher = executor.asCoroutineDispatcher()
  private val scope = CoroutineScope(dispatcher)

  private var encoder: MediaCodec? = null
  private var muxer: MediaMuxer? = null
  private var audioTrackIndex = -1
  private var muxerStarted = false
  private var presentationTimeUs = 0L
  private var sampleRate = 44100
  private var totalSamples = 0L

  override fun definition() = ModuleDefinition {
    Name("AudioEncoder")

    Function("startEncoding") { filePath: String, rate: Double ->
      sampleRate = rate.toInt()
      presentationTimeUs = 0L
      totalSamples = 0L

      val format = MediaFormat.createAudioFormat("audio/mp4a-latm", sampleRate, 1).apply {
        setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
      }
      encoder = MediaCodec.createEncoderByType("audio/mp4a-latm").also { codec ->
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
      }
      muxer = MediaMuxer(filePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      audioTrackIndex = -1
      muxerStarted = false
    }

    AsyncFunction("encodeChunk") { samples: TypedArray ->
      withContext(dispatcher) {
        val f32 = samples as? ExpoFloat32Array ?: return@withContext
        val floatBuf = f32.toDirectBuffer().asFloatBuffer()
        val floats = FloatArray(floatBuf.remaining()).also { floatBuf.get(it) }
        encodeFloats(floats)
      }
    }

    AsyncFunction("stopEncoding") { ->
      withContext(dispatcher) {
        signalEndOfStream()
        drainEncoder(endOfStream = true)
        muxer?.stop(); muxer?.release(); muxer = null
        encoder?.stop(); encoder?.release(); encoder = null
        muxerStarted = false; audioTrackIndex = -1
        (totalSamples.toDouble() / sampleRate * 1000.0)
      }
    }
  }

  private fun encodeFloats(floats: FloatArray) {
    val codec = encoder ?: return
    val pcm = floatToShortBytes(floats)
    var offset = 0
    while (offset < pcm.size) {
      drainEncoder(endOfStream = false)
      val idx = codec.dequeueInputBuffer(10_000L)
      if (idx < 0) continue
      val buf = codec.getInputBuffer(idx) ?: continue
      buf.clear()
      val toWrite = minOf(buf.capacity(), pcm.size - offset)
      buf.put(pcm, offset, toWrite)
      val samplesInBuffer = toWrite / 2
      codec.queueInputBuffer(idx, 0, toWrite, presentationTimeUs, 0)
      presentationTimeUs += (samplesInBuffer * 1_000_000L) / sampleRate
      totalSamples += samplesInBuffer
      offset += toWrite
    }
  }

  private fun signalEndOfStream() {
    val codec = encoder ?: return
    val idx = codec.dequeueInputBuffer(100_000L)
    if (idx >= 0) {
      codec.queueInputBuffer(idx, 0, 0, presentationTimeUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    }
  }

  private fun drainEncoder(endOfStream: Boolean) {
    val codec = encoder ?: return
    val info = MediaCodec.BufferInfo()
    while (true) {
      when (val idx = codec.dequeueOutputBuffer(info, 10_000L)) {
        MediaCodec.INFO_TRY_AGAIN_LATER -> { if (!endOfStream) return }
        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          audioTrackIndex = muxer!!.addTrack(codec.outputFormat)
          muxer!!.start()
          muxerStarted = true
        }
        else -> if (idx >= 0) {
          val buf = codec.getOutputBuffer(idx)!!
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (!isConfig && muxerStarted && info.size > 0) {
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            muxer!!.writeSampleData(audioTrackIndex, buf, info)
          }
          codec.releaseOutputBuffer(idx, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }
    }
  }

  private fun floatToShortBytes(samples: FloatArray): ByteArray {
    val out = ByteArray(samples.size * 2)
    val buf = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN)
    for (s in samples) buf.putShort((s.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
    return out
  }
}
```

---

## 5. File & Metadata Management (`src/lib/recordings.ts`)

Each recording is an M4A file in `<documentDirectory>/recordings/`. A JSON index file (`index.json` in the same directory) stores metadata.

```typescript
import * as FileSystem from 'expo-file-system';

export interface Recording {
  id: string;          // timestamp string, unique
  filePath: string;    // absolute file:// URI usable by expo-audio
  recordedAt: string;  // ISO 8601
  durationMs: number;
}

const DIR = FileSystem.documentDirectory + 'recordings/';
const INDEX = DIR + 'index.json';

export async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

export async function loadRecordings(): Promise<Recording[]> {
  await ensureDir();
  const info = await FileSystem.getInfoAsync(INDEX);
  if (!info.exists) return [];
  const json = await FileSystem.readAsStringAsync(INDEX);
  return JSON.parse(json) as Recording[];
}

export async function saveRecordings(recordings: Recording[]): Promise<void> {
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(recordings));
}

export function newFilePath(): string {
  // Return raw path (no file:// scheme) for native encoder
  const raw = DIR.replace('file://', '');
  return `${raw}recording_${Date.now()}.m4a`;
}
```

---

## 6. Modified `useVoiceMirror` Hook

### 6.1 Changes Overview

1. On phase transition `idle → recording`:
   - Generate a file path
   - Call `AudioEncoder.startEncoding(path, sampleRate)`
   - Feed the pre-onset chunks (audio already buffered from `voiceStartFrameRef` onward) into the encoder
2. In `onAudioReady` while `phaseRef.current === 'recording'`:
   - Call `AudioEncoder.encodeChunk(chunk)` (fire-and-forget)
3. In `stopAndPlay()`:
   - Call `AudioEncoder.stopEncoding()` → gets `durationMs`
   - Save metadata via `onRecordingComplete` callback

### 6.2 Updated `types.ts`

```typescript
export type Phase = 'idle' | 'recording' | 'playing' | 'paused';

export type VoiceMirrorState = {
  phase: Phase;
  levelHistory: number[];
  hasPermission: boolean;
  permissionDenied: boolean;
  togglePause: () => void;
};

export type RecordingCompleteCallback = (filePath: string, durationMs: number) => void;
```

### 6.3 `useVoiceMirror` Signature Change

```typescript
export function useVoiceMirror(
  onRecordingComplete: RecordingCompleteCallback,
): VoiceMirrorState
```

### 6.4 Pre-Onset Chunk Replay

When `tickStateMachine` transitions to `'recording'`, call a new helper.

All `AudioEncoder` methods can throw (native errors propagate as JS exceptions). The strategy is:
- `startEncoding` failure → log the error and leave `pendingFilePathRef` as `null`; in-memory playback continues normally and no recording is saved.
- `encodeChunk` failure → log and set an `encoderFailedRef` flag; skip further `encodeChunk` calls for the rest of this take.
- `stopEncoding` failure → log, skip `onRecordingComplete`; the partial file is left on disk but never added to the index (it will be cleaned up in a future GC pass or manually).

Add these refs to the hook:

```typescript
const pendingFilePathRef = useRef<string | null>(null);
const encoderFailedRef = useRef(false);
```

```typescript
function beginEncoding() {
  const ctx = audioContextRef.current!;
  const filePath = newFilePath();
  encoderFailedRef.current = false;

  try {
    // startEncoding is synchronous — opens the file, no I/O yet
    AudioEncoder.startEncoding(filePath, ctx.sampleRate);
    pendingFilePathRef.current = filePath;
  } catch (e) {
    console.error('[AudioEncoder] startEncoding failed:', e);
    return; // pendingFilePathRef stays null; encoding skipped for this take
  }

  // Replay buffered audio from voice onset frame onward
  const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
  let framesCounted = 0;
  for (const chunk of chunksRef.current) {
    const chunkStart = bufferStartFrame + framesCounted;
    const chunkEnd = chunkStart + chunk.length;
    framesCounted += chunk.length;

    if (chunkEnd <= voiceStartFrameRef.current) continue; // before onset

    const skipInChunk = Math.max(0, voiceStartFrameRef.current - chunkStart);
    const slice = skipInChunk > 0 ? chunk.slice(skipInChunk) : chunk;
    // Fire-and-forget; errors handled via encoderFailedRef
    AudioEncoder.encodeChunk(slice).catch(e => {
      console.error('[AudioEncoder] encodeChunk failed:', e);
      encoderFailedRef.current = true;
    });
  }
}
```

Add `const pendingFilePathRef = useRef<string | null>(null);` to the hook.

### 6.5 `tickStateMachine` — trigger `beginEncoding`

```typescript
// inside the idle → recording branch:
} else if (now - voiceStartTimeRef.current >= VOICE_ONSET_MS) {
  silenceStartTimeRef.current = null;
  phaseRef.current = 'recording';
  setPhase('recording');
  beginEncoding();   // ← new
}
```

### 6.6 `onAudioReady` — feed live chunks

```typescript
recorder.onAudioReady(config, ({ buffer, numFrames }) => {
  const chunk = new Float32Array(numFrames);
  buffer.copyFromChannel(chunk, 0);

  chunksRef.current.push(chunk);
  totalFramesRef.current += numFrames;
  bufferedFramesRef.current += numFrames;

  // Evict idle rolling window (unchanged)
  if (phaseRef.current === 'idle' && voiceStartTimeRef.current === null) { ... }

  // Feed encoder during recording (fire-and-forget)
  if (phaseRef.current === 'recording' && pendingFilePathRef.current && !encoderFailedRef.current) {
    AudioEncoder.encodeChunk(chunk).catch(e => {
      console.error('[AudioEncoder] encodeChunk failed:', e);
      encoderFailedRef.current = true;
    });
  }

  // RMS + state machine (unchanged)
  ...
});
```

### 6.7 `stopAndPlay` — finalize file, save metadata

When encoding fails for any reason (encoder error or `encoderFailedRef` set by a failed `encodeChunk`), the partial `.m4a` file must be deleted so it does not accumulate as orphan disk waste. Use `FileSystem.deleteAsync` with `idempotent: true` so the delete is safe even if the file was never created.

```typescript
async function stopAndPlay() {
  const ctx = audioContextRef.current!;
  const recorder = audioRecorderRef.current!;

  recorder.clearOnAudioReady();
  await recorder.stop();

  if (chunksRef.current.length === 0) {
    await startMonitoring();
    return;
  }

  // Finalize encoder in parallel with building the in-memory buffer
  const filePath = pendingFilePathRef.current;
  pendingFilePathRef.current = null;

  let durationMs = 0;
  if (filePath && !encoderFailedRef.current) {
    try {
      durationMs = await AudioEncoder.stopEncoding();
    } catch (e) {
      console.error('[AudioEncoder] stopEncoding failed:', e);
    }
  }

  // Clean up the partial file whenever encoding did not produce a valid result
  if (filePath && durationMs === 0) {
    FileSystem.deleteAsync('file://' + filePath, { idempotent: true }).catch(() => {});
  }

  if (filePath && durationMs > 0) {
    onRecordingComplete(filePath, durationMs);
  }

  // Existing in-memory playback (unchanged)
  const bufferedFrames = bufferedFramesRef.current;
  const audioBuffer = ctx.createBuffer(1, bufferedFrames, ctx.sampleRate);
  let offset = 0;
  for (const chunk of chunksRef.current) {
    audioBuffer.copyToChannel(chunk, 0, offset);
    offset += chunk.length;
  }
  const bufferStartFrame = totalFramesRef.current - bufferedFramesRef.current;
  const voiceStartSecs = (voiceStartFrameRef.current - bufferStartFrame) / ctx.sampleRate;

  const playerNode = ctx.createBufferSource();
  playerNodeRef.current = playerNode;
  playerNode.buffer = audioBuffer;
  playerNode.connect(ctx.destination);
  playerNode.onEnded = () => {
    playerNodeRef.current = null;
    void startMonitoring();
  };
  playerNode.start(0, voiceStartSecs);
}
```

---

## 7. `useRecordings` Hook (`src/hooks/useRecordings.ts`)

Manages the recordings list state and handles playback via `expo-audio`.

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import { Recording, loadRecordings, saveRecordings } from '../lib/recordings';

export type PlayState = { recordingId: string; isPlaying: boolean } | null;

export type RecordingsState = {
  recordings: Recording[];
  playState: PlayState;
  addRecording: (filePath: string, durationMs: number) => Promise<void>;
  togglePlay: (recording: Recording) => void;
};

export function useRecordings(): RecordingsState {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playState, setPlayState] = useState<PlayState>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    loadRecordings().then(setRecordings);
    return () => {
      playerRef.current?.remove();
      playerRef.current = null;
    };
  }, []);

  const stopCurrentPlayer = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.remove();
      playerRef.current = null;
      setPlayState(null);
    }
  }, []);

  const addRecording = useCallback(async (filePath: string, durationMs: number) => {
    const entry: Recording = {
      id: String(Date.now()),
      filePath: 'file://' + filePath,
      recordedAt: new Date().toISOString(),
      durationMs,
    };
    setRecordings(prev => {
      const next = [entry, ...prev];
      void saveRecordings(next);
      return next;
    });
  }, []);

  const togglePlay = useCallback((recording: Recording) => {
    // Tapping the currently-playing item stops it
    if (playState?.recordingId === recording.id && playState.isPlaying) {
      stopCurrentPlayer();
      return;
    }

    // Stop any other player first
    stopCurrentPlayer();

    const player = createAudioPlayer({ uri: recording.filePath });
    playerRef.current = player;
    setPlayState({ recordingId: recording.id, isPlaying: true });

    player.addListener('playbackStatusUpdate', status => {
      if (status.didJustFinish) {
        player.remove();
        playerRef.current = null;
        setPlayState(null);
      }
    });

    player.play();
  }, [playState, stopCurrentPlayer]);

  return { recordings, playState, addRecording, togglePlay };
}
```

---

## 8. UI Components

### 8.1 `RecordingItem.tsx`

```typescript
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { Recording } from '../lib/recordings';
import type { PlayState } from '../hooks/useRecordings';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + '  '
    + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Props = {
  recording: Recording;
  playState: PlayState;
  onTogglePlay: () => void;
};

export function RecordingItem({ recording, playState, onTogglePlay }: Props) {
  const isPlaying = playState?.recordingId === recording.id && playState.isPlaying;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onTogglePlay}
        style={({ pressed }) => [styles.playButton, pressed && styles.playButtonPressed]}
        hitSlop={8}
      >
        <Text style={styles.playIcon}>{isPlaying ? '■' : '▶'}</Text>
      </Pressable>
      <View style={styles.meta}>
        <Text style={styles.date}>{formatDate(recording.recordedAt)}</Text>
        <Text style={styles.duration}>{formatDuration(recording.durationMs)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4A9EFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonPressed: { opacity: 0.7 },
  playIcon: { color: '#FFF', fontSize: 14, lineHeight: 16 },
  meta: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 13, color: '#444' },
  duration: { fontSize: 13, color: '#888', fontVariant: ['tabular-nums'] },
});
```

### 8.2 `RecordingsList.tsx`

```typescript
import { FlatList, View, Text, StyleSheet } from 'react-native';
import type { Recording } from '../lib/recordings';
import type { PlayState } from '../hooks/useRecordings';
import { RecordingItem } from './RecordingItem';

type Props = {
  recordings: Recording[];
  playState: PlayState;
  onTogglePlay: (r: Recording) => void;
};

export function RecordingsList({ recordings, playState, onTogglePlay }: Props) {
  if (recordings.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No recordings yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={recordings}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <RecordingItem
          recording={item}
          playState={playState}
          onTogglePlay={() => onTogglePlay(item)}
        />
      )}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#BBB', fontSize: 14 },
});
```

---

## 9. Updated `VoiceMirrorScreen`

The screen splits into a top monitor section (fixed height) and a bottom recordings list (flex).

```typescript
import { View, Text, StyleSheet, SafeAreaView, Pressable } from 'react-native';
import { useVoiceMirror } from '../hooks/useVoiceMirror';
import { useRecordings } from '../hooks/useRecordings';
import { AudioLevelMeter } from '../components/AudioLevelMeter';
import { PhaseDisplay } from '../components/PhaseDisplay';
import { RecordingsList } from '../components/RecordingsList';

export function VoiceMirrorScreen() {
  const { recordings, playState, addRecording, togglePlay } = useRecordings();

  const { phase, levelHistory, hasPermission, permissionDenied, togglePause } =
    useVoiceMirror(addRecording);

  const isPaused = phase === 'paused';

  if (permissionDenied) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Microphone access required</Text>
          <Text style={styles.errorBody}>
            Go to Settings → VoiceMirror → Microphone and allow access.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.hint}>Requesting microphone access…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* Top: voice mirror monitor */}
      <View style={styles.monitor}>
        <PhaseDisplay phase={phase} />
        <View style={styles.meterContainer}>
          <AudioLevelMeter history={levelHistory} phase={phase} />
        </View>
        <Text style={styles.hint}>
          {isPaused ? 'Monitoring paused.' : 'Speak to begin. Silence ends the take.'}
        </Text>
        <Pressable
          onPress={togglePause}
          style={({ pressed }) => [styles.pauseButton, pressed && styles.pauseButtonPressed]}
        >
          <Text style={styles.pauseButtonLabel}>{isPaused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Bottom: recordings list */}
      <RecordingsList
        recordings={recordings}
        playState={playState}
        onTogglePlay={togglePlay}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  monitor: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 32,
    gap: 24,
  },
  meterContainer: { width: '100%', alignItems: 'center' },
  hint: { color: '#AAA', fontSize: 14, textAlign: 'center' },
  pauseButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 30,
    backgroundColor: '#EEEEEE',
  },
  pauseButtonPressed: { backgroundColor: '#DDDDDD' },
  pauseButtonLabel: { fontSize: 16, fontWeight: '600', color: '#555555' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#DDD' },
  errorTitle: {
    fontSize: 18, fontWeight: '600', color: '#333', marginBottom: 12, textAlign: 'center',
  },
  errorBody: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22 },
});
```

---

## 10. File Structure After Implementation

```
VoiceMirror/
├── modules/
│   └── audio-encoder/
│       ├── package.json
│       ├── index.ts
│       ├── expo-module.config.json
│       ├── src/
│       │   └── AudioEncoderModule.ts
│       ├── ios/
│       │   └── AudioEncoderModule.swift
│       └── android/
│           └── AudioEncoderModule.kt
└── src/
    ├── constants/audio.ts          (unchanged)
    ├── lib/
    │   └── recordings.ts           (new)
    ├── hooks/
    │   ├── types.ts                (add RecordingCompleteCallback)
    │   ├── useVoiceMirror.ts       (add encoder calls)
    │   └── useRecordings.ts        (new)
    └── components/
        ├── AudioLevelMeter.tsx     (unchanged)
        ├── PhaseDisplay.tsx        (unchanged)
        ├── RecordingItem.tsx       (new)
        └── RecordingsList.tsx      (new)
```

---

## 11. Todo List

### Phase 1 — Project Setup ✅

- [x] `pnpm add expo-audio expo-file-system`
- [x] Create `modules/audio-encoder/` directory tree (`ios/`, `android/`, `src/`)
- [x] Write `modules/audio-encoder/package.json` (name, version, expo autolinking config)
- [x] Write `modules/audio-encoder/expo-module.config.json` (link AudioToolbox for iOS)
- [x] Add `"audio-encoder": "file:./modules/audio-encoder"` to root `package.json`
- [x] Run `pnpm install`

### Phase 2 — Native Encoder Module ✅

#### iOS (Swift)
- [x] Create `modules/audio-encoder/ios/AudioEncoderModule.swift`
- [x] Implement `startEncoding(filePath:sampleRate:)` — open ExtAudioFile with AAC output format and Float32 client format
- [x] Implement `encodeChunk(samples:)` AsyncFunction — copy TypedArray to `[Float]`, dispatch write to serial queue via `encoderQueue.sync`
- [x] Implement `stopEncoding()` AsyncFunction — `ExtAudioFileDispose` on serial queue, return duration in ms
- [x] Define `EncoderException` class

#### Android (Kotlin)
- [x] Create `modules/audio-encoder/android/AudioEncoderModule.kt`
- [x] Implement `startEncoding` Function — configure `MediaCodec` ("audio/mp4a-latm", AACObjectLC, 128 kbps) and `MediaMuxer`
- [x] Implement `encodeChunk` AsyncFunction — convert Float32→Int16, feed PCM into MediaCodec via `encodeFloats()`, drain output
- [x] Implement `stopEncoding` AsyncFunction — signal EOS input buffer, drain encoder to output EOS, `muxer.stop()` / `muxer.release()`, return duration in ms
- [x] Implement private helpers: `encodeFloats`, `signalEndOfStream`, `drainEncoder`, `floatToShortBytes`

#### TypeScript interface
- [x] Create `modules/audio-encoder/src/AudioEncoderModule.ts` — `requireNativeModule` with typed interface (`startEncoding`, `encodeChunk`, `stopEncoding`)
- [x] Create `modules/audio-encoder/index.ts` — re-export default

### Phase 3 — File & Metadata Layer ✅

- [x] Create `src/lib/recordings.ts`
- [x] Implement `ensureDir()` — create `documentDirectory/recordings/` if absent
- [x] Implement `loadRecordings()` — read and parse `index.json`; return `[]` if absent
- [x] Implement `saveRecordings(recordings)` — write `index.json`
- [x] Implement `newFilePath()` — return timestamped raw path (no `file://` prefix) for native encoder

### Phase 4 — Hook: `useVoiceMirror` Updates ✅

- [x] Add `RecordingCompleteCallback` type to `src/hooks/types.ts`
- [x] Add `onRecordingComplete: RecordingCompleteCallback` parameter to `useVoiceMirror`
- [x] Add `pendingFilePathRef` and `encoderFailedRef` refs
- [x] Implement `beginEncoding()` helper:
  - [x] Call `newFilePath()` and `AudioEncoder.startEncoding(...)` in `try/catch`
  - [x] Replay pre-onset chunks from `voiceStartFrameRef` into `AudioEncoder.encodeChunk(...).catch(...)`
- [x] Call `beginEncoding()` at the `idle → recording` transition in `tickStateMachine`
- [x] In `onAudioReady`, add guarded fire-and-forget `AudioEncoder.encodeChunk(chunk).catch(...)` during `'recording'` phase
- [x] In `stopAndPlay()`, call `AudioEncoder.stopEncoding()` in `try/catch`, then `FileSystem.deleteAsync` on failure, then `onRecordingComplete` on success
- [x] Import `FileSystem` from `expo-file-system` in `useVoiceMirror.ts`

### Phase 5 — Hook: `useRecordings` ✅

- [x] Create `src/hooks/useRecordings.ts`
- [x] Load recordings from `loadRecordings()` on mount; cleanup player on unmount
- [x] Implement `addRecording(filePath, durationMs)` — prepend entry to state and persist via `saveRecordings`
- [x] Implement `togglePlay(recording)` — stop current player if any; create new `AudioPlayer` via `createAudioPlayer`, register `playbackStatusUpdate` listener for `didJustFinish`, call `player.play()`

### Phase 6 — UI Components ✅

- [x] Create `src/components/RecordingItem.tsx`
  - [x] `formatDate(iso)` helper — locale short date + time
  - [x] `formatDuration(ms)` helper — `m:ss`
  - [x] Row layout: play/stop button + date label + duration label
  - [x] Button shows ▶ or ■ depending on `playState`
- [x] Create `src/components/RecordingsList.tsx`
  - [x] Empty-state view ("No recordings yet") when `recordings.length === 0`
  - [x] `FlatList` rendering `RecordingItem` otherwise

### Phase 7 — Screen Integration ✅

- [x] Update `src/screens/VoiceMirrorScreen.tsx`:
  - [x] Instantiate `useRecordings()`
  - [x] Pass `addRecording` as `onRecordingComplete` to `useVoiceMirror`
  - [x] Split layout: `<View style={styles.monitor}>` (existing UI) + `<View style={styles.divider}/>` + `<RecordingsList>`
  - [x] Add `monitor` and `divider` styles; remove `center` flex-1 layout

### Phase 8 — Native Rebuild & Smoke Test

- [x] Run `expo run:ios` to rebuild with new native module
- [ ] Run `expo run:android` to rebuild with new native module
- [ ] Smoke test iOS: record a take, confirm `.m4a` appears in `documentDirectory/recordings/`, confirm item appears in list with correct duration and date
- [ ] Smoke test Android: same as above
- [ ] Smoke test playback: tap ▶ on a list item, confirm audio plays; tap ■ to stop
- [ ] Smoke test error path: simulate encoder failure (e.g. bad path), confirm no orphan entry in list and partial file is deleted
- [ ] Smoke test app restart: relaunch app, confirm past recordings reappear in list

---

## 12. Key Design Decisions

### Encoding runs in parallel with in-memory playback

`AudioEncoder.stopEncoding()` and the `AudioBufferSourceNode` playback both start concurrently via `Promise.all`. The file is finalized while the user is hearing the playback, so there is no added latency.

### Pre-onset audio is included in the file

`beginEncoding()` replays the buffered chunks from `voiceStartFrameRef` onward before live chunks arrive. The file starts at the actual voice onset — matching what the user hears during in-memory playback — with no leading silence.

### Fire-and-forget `encodeChunk` calls

`encodeChunk` is called without `await` in the hot `onAudioReady` path. The native serial queue (iOS: `DispatchQueue`; Android: single-thread executor) ensures chunks are encoded in order regardless. The ~93 ms gap between calls gives the encoder plenty of slack.

### Metadata persisted synchronously with state

`addRecording` updates React state and writes `index.json` atomically. On app restart, `useRecordings` loads the index and all past recordings reappear — files remain on disk until explicitly deleted (future feature).

### `expo-audio` for list playback

The list uses `expo-audio` (not `react-native-audio-api`) because it supports file URIs directly via `createAudioPlayer({ uri })`, handles audio session management automatically, and does not interfere with the `AudioRecorder` when monitoring is paused. `createAudioPlayer` is the imperative API, suitable for use inside a custom hook without tying the player lifetime to a component. Playing from the list while monitoring is active is intentionally not supported in this version — the user should pause monitoring first.

### Error handling for native encoder

All three `AudioEncoder` call sites are guarded:
- `startEncoding` (sync): wrapped in `try/catch`; failure leaves `pendingFilePathRef` as `null`, silently skipping file output for that take.
- `encodeChunk` (async, fire-and-forget): `.catch()` sets `encoderFailedRef = true`; subsequent chunk calls are skipped for the rest of the take.
- `stopEncoding` (async, awaited): wrapped in `try/catch`; failure prevents `onRecordingComplete` from being called, so no corrupt entry appears in the list. In all failure cases (`encoderFailedRef` set or `stopEncoding` throws), the partial file is deleted with `FileSystem.deleteAsync(..., { idempotent: true })` to avoid orphan disk waste.

In all cases the in-memory playback loop is unaffected.
