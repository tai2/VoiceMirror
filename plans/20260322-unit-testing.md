# Plan: Unit Testing Facility

> Date: 2026-03-22

## Goal

Set up Jest + React Testing Library, extract services and repositories to allow stub-based unit testing of the application logic without touching real hardware APIs (`react-native-audio-api`, `expo-file-system`, `audio-encoder`).

---

## Step 1: Install & Configure Jest

### 1-1. Install dependencies

```sh
npx expo install jest-expo jest @types/jest @testing-library/react-native --dev
```

### 1-2. Add to `package.json`

```json
{
  "scripts": {
    "test": "jest --watchAll",
    "test:ci": "jest"
  },
  "jest": {
    "preset": "jest-expo",
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|react-native-audio-api)"
    ]
  }
}
```

**Why `transformIgnorePatterns`?** `react-native-audio-api` ships ES modules (not CommonJS). Jest's default transformer excludes all of `node_modules`, which breaks ES-module-only packages. Whitelisting them forces Babel to transform them.

`audio-encoder` is a local module (`file:./modules/audio-encoder`) so Jest transforms it by default — no whitelist entry needed. It will still be mocked entirely in tests.

---

## Step 2: Define Interfaces

Create the interface files first. Real implementations and stubs both implement these, which makes them interchangeable in tests.

### `src/services/AudioRecordingService.ts`

```typescript
export interface AudioChunkEvent {
  chunk: Float32Array;
  numFrames: number;
}

export interface IAudioRecorder {
  start(): Promise<void>;
  stop(): Promise<void>;
  onAudioReady(
    config: { sampleRate: number; bufferLength: number; channelCount: number },
    callback: (event: AudioChunkEvent) => void,
  ): void;
  clearOnAudioReady(): void;
}

export interface IAudioRecordingService {
  requestRecordingPermissions(): Promise<'Granted' | 'Denied' | 'NotDetermined'>;
  setAudioSessionOptions(options: {
    iosCategory: string;
    iosOptions: string[];
  }): void;
  setAudioSessionActivity(active: boolean): Promise<void>;
  createRecorder(): IAudioRecorder;
}
```

Note: `IAudioRecorder.onAudioReady` delivers a pre-extracted `Float32Array` instead of the raw `AudioBuffer`. The real implementation does the extraction inside; stubs can fire arbitrary chunks directly.

### `src/services/AudioEncoderService.ts`

```typescript
export interface IAudioEncoderService {
  startEncoding(filePath: string, sampleRate: number): void;
  encodeChunk(samples: Float32Array): void;
  stopEncoding(): Promise<number>; // resolves to durationMs
}
```

### `src/services/AudioDecoderService.ts`

```typescript
import type { AudioBuffer } from 'react-native-audio-api';

export interface IAudioDecoderService {
  decodeAudioData(filePath: string, sampleRate: number): Promise<AudioBuffer>;
}
```

### `src/repositories/RecordingsRepository.ts`

```typescript
import type { Recording } from '../lib/recordings';

export interface IRecordingsRepository {
  load(): Promise<Recording[]>;
  save(recordings: Recording[]): void;
  newFilePath(): string;
  deleteFile(path: string): void;
}
```

---

## Step 3: Implement Real Services & Repository

### `src/services/AudioRecordingService.ts` (add after the interface)

```typescript
import { AudioRecorder, AudioManager } from 'react-native-audio-api';

class RealAudioRecorder implements IAudioRecorder {
  private recorder: AudioRecorder;

  constructor() {
    this.recorder = new AudioRecorder();
  }

  start() { return this.recorder.start(); }
  stop()  { return this.recorder.stop(); }
  clearOnAudioReady() { this.recorder.clearOnAudioReady(); }

  onAudioReady(
    config: { sampleRate: number; bufferLength: number; channelCount: number },
    callback: (event: AudioChunkEvent) => void,
  ) {
    this.recorder.onAudioReady(config, ({ buffer, numFrames }) => {
      const chunk = new Float32Array(numFrames);
      buffer.copyFromChannel(chunk, 0);
      callback({ chunk, numFrames });
    });
  }
}

export class RealAudioRecordingService implements IAudioRecordingService {
  requestRecordingPermissions() {
    return AudioManager.requestRecordingPermissions();
  }

  setAudioSessionOptions(options: { iosCategory: string; iosOptions: string[] }) {
    AudioManager.setAudioSessionOptions(options);
  }

  setAudioSessionActivity(active: boolean) {
    return AudioManager.setAudioSessionActivity(active);
  }

  createRecorder(): IAudioRecorder {
    return new RealAudioRecorder();
  }
}
```

### `src/services/AudioEncoderService.ts` (add after the interface)

```typescript
import AudioEncoder from 'audio-encoder';

export class RealAudioEncoderService implements IAudioEncoderService {
  startEncoding(filePath: string, sampleRate: number) {
    AudioEncoder.startEncoding(filePath, sampleRate);
  }
  encodeChunk(samples: Float32Array) {
    AudioEncoder.encodeChunk(samples);
  }
  stopEncoding() {
    return AudioEncoder.stopEncoding();
  }
}
```

### `src/services/AudioDecoderService.ts` (add after the interface)

```typescript
import { decodeAudioData } from 'react-native-audio-api';

export class RealAudioDecoderService implements IAudioDecoderService {
  decodeAudioData(filePath: string, sampleRate: number) {
    return decodeAudioData(filePath, sampleRate);
  }
}
```

### `src/repositories/RecordingsRepository.ts` (add after the interface)

```typescript
import { File } from 'expo-file-system';
import {
  type Recording,
  loadRecordings,
  saveRecordings,
  newFilePath as libNewFilePath,
} from '../lib/recordings';

export class RealRecordingsRepository implements IRecordingsRepository {
  load() { return loadRecordings(); }
  save(recordings: Recording[]) { saveRecordings(recordings); }
  newFilePath() { return libNewFilePath(); }
  deleteFile(path: string) { new File('file://' + path).delete(); }
}
```

---

## Step 4: Create Context Providers

Context providers allow the screen (and any UI component) to get services without prop-drilling. In tests, we replace the providers with stubs.

### `src/context/ServicesProvider.tsx`

```typescript
import React, { createContext, useContext } from 'react';
import type { IAudioRecordingService } from '../services/AudioRecordingService';
import type { IAudioEncoderService } from '../services/AudioEncoderService';
import type { IAudioDecoderService } from '../services/AudioDecoderService';
import type { IRecordingsRepository } from '../repositories/RecordingsRepository';

type Services = {
  recordingService: IAudioRecordingService;
  encoderService: IAudioEncoderService;
  decoderService: IAudioDecoderService;
  recordingsRepository: IRecordingsRepository;
};

const ServicesCtx = createContext<Services | null>(null);

export function ServicesProvider({
  children,
  services,
}: {
  children: React.ReactNode;
  services: Services;
}) {
  return <ServicesCtx.Provider value={services}>{children}</ServicesCtx.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesCtx);
  if (!ctx) throw new Error('useServices must be used inside ServicesProvider');
  return ctx;
}
```

### In `App.tsx` — wire up real services

```typescript
import { ServicesProvider } from './src/context/ServicesProvider';
import { RealAudioRecordingService } from './src/services/AudioRecordingService';
import { RealAudioEncoderService } from './src/services/AudioEncoderService';
import { RealAudioDecoderService } from './src/services/AudioDecoderService';
import { RealRecordingsRepository } from './src/repositories/RecordingsRepository';

const realServices = {
  recordingService: new RealAudioRecordingService(),
  encoderService: new RealAudioEncoderService(),
  decoderService: new RealAudioDecoderService(),
  recordingsRepository: new RealRecordingsRepository(),
};

export default function App() {
  return (
    <ServicesProvider services={realServices}>
      <VoiceMirrorScreen />
    </ServicesProvider>
  );
}
```

---

## Step 5: Refactor `useVoiceMirror`

### New signature

Services are injected as arguments instead of imported directly at the top.

```typescript
export function useVoiceMirror(
  onRecordingComplete: RecordingCompleteCallback,
  audioContext: AudioContext | null,
  recordingService: IAudioRecordingService,
  encoderService: IAudioEncoderService,
  repository: IRecordingsRepository,
): VoiceMirrorState
```

### Key changes inside the hook

| Before | After |
|--------|-------|
| `const ctx = useAudioContext()` | `audioContext` parameter — remove the `useAudioContext()` call |
| `import AudioEncoder from 'audio-encoder'` | removed; use `encoderService` |
| `AudioEncoder.startEncoding(...)` | `encoderService.startEncoding(...)` |
| `AudioEncoder.encodeChunk(chunk)` | `encoderService.encodeChunk(chunk)` |
| `AudioEncoder.stopEncoding()` | `encoderService.stopEncoding()` |
| `import { AudioRecorder, AudioManager }` | removed; use `recordingService` |
| `new AudioRecorder()` | `recordingService.createRecorder()` |
| `AudioManager.requestRecordingPermissions()` | `recordingService.requestRecordingPermissions()` |
| `AudioManager.setAudioSessionOptions(...)` | `recordingService.setAudioSessionOptions(...)` |
| `AudioManager.setAudioSessionActivity(...)` | `recordingService.setAudioSessionActivity(...)` |
| `import { File } from 'expo-file-system'` | removed |
| `new File('file://' + filePath).delete()` | `repository.deleteFile(filePath)` |
| `newFilePath()` from `lib/recordings` | `repository.newFilePath()` |
| `recorder.onAudioReady(config, ({ buffer, numFrames }) => { buffer.copyFromChannel(...) })` | `recorder.onAudioReady(config, ({ chunk, numFrames }) => { ... })` (chunk is already Float32Array) |

The `audioRecorderRef` type changes from `AudioRecorder | null` to `IAudioRecorder | null`.

### Condensed refactored structure

```typescript
import { useEffect, useRef, useState } from 'react';
import type { AudioContext } from 'react-native-audio-api';
import type { IAudioRecordingService, IAudioRecorder } from '../services/AudioRecordingService';
import type { IAudioEncoderService } from '../services/AudioEncoderService';
import type { IRecordingsRepository } from '../repositories/RecordingsRepository';
// ... constants and types ...

export function useVoiceMirror(
  onRecordingComplete: RecordingCompleteCallback,
  audioContext: AudioContext | null,
  recordingService: IAudioRecordingService,
  encoderService: IAudioEncoderService,
  repository: IRecordingsRepository,
): VoiceMirrorState {
  // ... state unchanged ...

  const audioRecorderRef = useRef<IAudioRecorder | null>(null);

  useEffect(() => {
    if (!audioContext) return;

    (async () => {
      const status = await recordingService.requestRecordingPermissions();
      if (status !== 'Granted') { setPermissionDenied(true); return; }
      setHasPermission(true);
      recordingService.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosOptions: ['defaultToSpeaker'] });
      audioRecorderRef.current = recordingService.createRecorder();
      await startMonitoringRef.current();
    })();

    return () => {
      audioRecorderRef.current?.clearOnAudioReady();
      void audioRecorderRef.current?.stop();
    };
  }, [audioContext, recordingService]);

  function beginEncoding() {
    const filePath = repository.newFilePath();
    encoderService.startEncoding(filePath, audioContext!.sampleRate);
    // ... rest unchanged, but use encoderService.encodeChunk() ...
  }

  async function startMonitoring() {
    // ...
    recorder.onAudioReady(config, ({ chunk, numFrames }) => {
      // chunk is already Float32Array — no buffer.copyFromChannel needed
      chunksRef.current.push(chunk);
      // ...
      if (phaseRef.current === 'recording' && ...) {
        encoderService.encodeChunk(chunk);
      }
      // ...
    });
  }

  async function stopAndPlay() {
    // ...
    durationMs = await encoderService.stopEncoding();
    // ...
    if (filePath && durationMs === 0) {
      repository.deleteFile(filePath);
      // ...
    }
    // ...
  }
  // ... rest unchanged ...
}
```

---

## Step 6: Refactor `useRecordings`

### New signature

```typescript
export function useRecordings(
  options: RecordingsOptions,
  audioContext: AudioContext | null,
  repository: IRecordingsRepository,
  decoderService: IAudioDecoderService,
): RecordingsState
```

### Key changes inside the hook

| Before | After |
|--------|-------|
| `const ctx = useAudioContext()` | `audioContext` parameter |
| `import { decodeAudioData }` from `react-native-audio-api` | removed |
| `import { loadRecordings, saveRecordings }` from `lib/recordings` | removed |
| `loadRecordings()` | `repository.load()` |
| `saveRecordings(next)` | `repository.save(next)` |
| `decodeAudioData(recording.filePath, ctx.sampleRate)` | `decoderService.decodeAudioData(recording.filePath, audioContext.sampleRate)` |
| `ctx.createBufferSource()` | `audioContext.createBufferSource()` |

### Condensed refactored structure

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import type { AudioContext, AudioBuffer, AudioBufferSourceNode } from 'react-native-audio-api';
import type { IRecordingsRepository } from '../repositories/RecordingsRepository';
import type { IAudioDecoderService } from '../services/AudioDecoderService';
import type { Recording } from '../lib/recordings';

export function useRecordings(
  options: RecordingsOptions,
  audioContext: AudioContext | null,
  repository: IRecordingsRepository,
  decoderService: IAudioDecoderService,
): RecordingsState {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playState, setPlayState] = useState<PlayState>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isDecodingRef = useRef(false);

  useEffect(() => {
    repository.load().then(setRecordings);
    return () => { /* cleanup sourceRef */ };
  }, [repository]);

  const addRecording = useCallback((filePath: string, durationMs: number) => {
    const entry: Recording = {
      id: String(Date.now()),
      filePath: 'file://' + filePath,
      recordedAt: new Date().toISOString(),
      durationMs,
    };
    setRecordings(prev => {
      const next = [entry, ...prev];
      repository.save(next);
      return next;
    });
  }, [repository]);

  const togglePlay = useCallback(async (recording: Recording) => {
    if (!audioContext) return;
    // ...
    const audioBuffer = await decoderService.decodeAudioData(recording.filePath, audioContext.sampleRate);
    const source = audioContext.createBufferSource();
    // ... rest unchanged ...
  }, [playState, audioContext, decoderService, repository, stopCurrentPlayer, options]);

  return { recordings, playState, addRecording, togglePlay };
}
```

---

## Step 7: Update `VoiceMirrorScreen`

`VoiceMirrorContent` reads services from the context and passes them to hooks.

```typescript
import { useAudioContext } from '../context/AudioContextProvider';
import { useServices } from '../context/ServicesProvider';

function VoiceMirrorContent() {
  const audioContext = useAudioContext();
  const { recordingService, encoderService, decoderService, recordingsRepository } = useServices();

  // ref bridge unchanged...

  const voiceMirror = useVoiceMirror(
    stableAddRecording,
    audioContext,
    recordingService,
    encoderService,
    recordingsRepository,
  );

  const recordingsState = useRecordings(
    { onWillPlay: stableSuspend, onDidStop: stableResume },
    audioContext,
    recordingsRepository,
    decoderService,
  );

  // ... rest unchanged ...
}
```

---

## Step 8: Stub Implementations for Tests

Create these under `src/__tests__/stubs/`. They implement the same interfaces but are controllable in tests.

### `src/__tests__/stubs/stubAudioRecordingService.ts`

```typescript
import type {
  IAudioRecordingService,
  IAudioRecorder,
  AudioChunkEvent,
} from '../../services/AudioRecordingService';

export class StubAudioRecorder implements IAudioRecorder {
  private callback: ((event: AudioChunkEvent) => void) | null = null;

  start = jest.fn().mockResolvedValue(undefined);
  stop  = jest.fn().mockResolvedValue(undefined);
  clearOnAudioReady = jest.fn(() => { this.callback = null; });

  onAudioReady(
    _config: { sampleRate: number; bufferLength: number; channelCount: number },
    callback: (event: AudioChunkEvent) => void,
  ) {
    this.callback = callback;
  }

  /** Call this in tests to simulate audio arriving from the microphone. */
  simulateChunk(chunk: Float32Array) {
    this.callback?.({ chunk, numFrames: chunk.length });
  }
}

export class StubAudioRecordingService implements IAudioRecordingService {
  recorder = new StubAudioRecorder();

  requestRecordingPermissions = jest.fn().mockResolvedValue('Granted' as const);
  setAudioSessionOptions = jest.fn();
  setAudioSessionActivity = jest.fn().mockResolvedValue(undefined);
  createRecorder = jest.fn(() => this.recorder);
}
```

### `src/__tests__/stubs/stubAudioEncoderService.ts`

```typescript
import type { IAudioEncoderService } from '../../services/AudioEncoderService';

export class StubAudioEncoderService implements IAudioEncoderService {
  startEncoding = jest.fn();
  encodeChunk   = jest.fn();
  stopEncoding  = jest.fn().mockResolvedValue(1000); // 1 second by default
}
```

### `src/__tests__/stubs/stubAudioDecoderService.ts`

```typescript
import type { IAudioDecoderService } from '../../services/AudioDecoderService';
import type { AudioBuffer } from 'react-native-audio-api';

export function makeStubAudioBuffer(length = 44100): AudioBuffer {
  return {
    length,
    duration: length / 44100,
    numberOfChannels: 1,
    sampleRate: 44100,
    getChannelData: jest.fn(() => new Float32Array(length)),
    copyFromChannel: jest.fn(),
    copyToChannel: jest.fn(),
  } as unknown as AudioBuffer;
}

export class StubAudioDecoderService implements IAudioDecoderService {
  decodeAudioData = jest.fn().mockResolvedValue(makeStubAudioBuffer());
}
```

### `src/__tests__/stubs/stubRecordingsRepository.ts`

```typescript
import type { IRecordingsRepository } from '../../repositories/RecordingsRepository';
import type { Recording } from '../../lib/recordings';

export class StubRecordingsRepository implements IRecordingsRepository {
  private data: Recording[] = [];
  private counter = 0;

  load  = jest.fn(async () => [...this.data]);
  save  = jest.fn((recordings: Recording[]) => { this.data = recordings; });
  newFilePath = jest.fn(() => `/tmp/recording_${++this.counter}.m4a`);
  deleteFile  = jest.fn();

  /** Seed initial data for tests that need pre-loaded recordings. */
  seed(recordings: Recording[]) {
    this.data = recordings;
    this.load.mockResolvedValue([...this.data]);
  }
}
```

### `src/__tests__/stubs/stubAudioContext.ts`

```typescript
import type { AudioContext, AudioBuffer, AudioBufferSourceNode } from 'react-native-audio-api';

export function makeStubAudioContext(sampleRate = 44100): AudioContext {
  const stubbedSource: AudioBufferSourceNode = {
    buffer: null,
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    onEnded: null,
  } as unknown as AudioBufferSourceNode;

  const stubbedBuffer: AudioBuffer = {
    length: sampleRate,
    duration: 1,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: jest.fn(() => new Float32Array(sampleRate)),
    copyFromChannel: jest.fn(),
    copyToChannel: jest.fn(),
  } as unknown as AudioBuffer;

  return {
    sampleRate,
    destination: {} as any,
    createBuffer: jest.fn(() => stubbedBuffer),
    createBufferSource: jest.fn(() => stubbedSource),
    resume: jest.fn().mockResolvedValue(undefined),
    suspend: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as AudioContext;
}
```

---

## Step 9: Write Tests

### File organization

```
src/
  hooks/
    __tests__/
      useVoiceMirror.test.ts
      useRecordings.test.ts
  lib/
    __tests__/
      recordings.test.ts
  components/
    __tests__/
      AudioLevelMeter.test.tsx
      PhaseDisplay.test.tsx
      RecordingItem.test.tsx
  repositories/
    __tests__/
      RecordingsRepository.test.ts
  __tests__/
    stubs/
      stubAudioRecordingService.ts
      stubAudioEncoderService.ts
      stubAudioDecoderService.ts
      stubRecordingsRepository.ts
      stubAudioContext.ts
```

---

### Example: `useVoiceMirror` tests

```typescript
// src/hooks/__tests__/useVoiceMirror.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { useVoiceMirror } from '../useVoiceMirror';
import { StubAudioRecordingService } from '../../__tests__/stubs/stubAudioRecordingService';
import { StubAudioEncoderService } from '../../__tests__/stubs/stubAudioEncoderService';
import { StubRecordingsRepository } from '../../__tests__/stubs/stubRecordingsRepository';
import { makeStubAudioContext } from '../../__tests__/stubs/stubAudioContext';
import { VOICE_THRESHOLD_DB, VOICE_ONSET_MS, SILENCE_THRESHOLD_DB, SILENCE_DURATION_MS, MIN_RECORDING_MS } from '../../constants/audio';

function makeChunk(db: number, sampleRate = 44100, durationMs = 100): Float32Array {
  const numFrames = Math.round((durationMs / 1000) * sampleRate);
  const rms = Math.pow(10, db / 20);
  const chunk = new Float32Array(numFrames);
  // Fill with a sine wave scaled to the target RMS
  chunk.fill(rms);
  return chunk;
}

function setup() {
  const onRecordingComplete = jest.fn();
  const recordingService = new StubAudioRecordingService();
  const encoderService = new StubAudioEncoderService();
  const repository = new StubRecordingsRepository();
  const audioContext = makeStubAudioContext();

  const { result } = renderHook(() =>
    useVoiceMirror(onRecordingComplete, audioContext, recordingService, encoderService, repository),
  );

  return { result, onRecordingComplete, recordingService, encoderService, repository, audioContext };
}

describe('useVoiceMirror — permissions', () => {
  it('starts with hasPermission false', () => {
    const { result } = setup();
    expect(result.current.hasPermission).toBe(false);
  });

  it('sets hasPermission after permission granted', async () => {
    const { result, recordingService } = setup();
    recordingService.requestRecordingPermissions.mockResolvedValue('Granted');
    // wait for the useEffect async block
    await act(async () => { await Promise.resolve(); });
    expect(result.current.hasPermission).toBe(true);
  });

  it('sets permissionDenied when permission is Denied', async () => {
    const { result, recordingService } = setup();
    recordingService.requestRecordingPermissions.mockResolvedValue('Denied');
    await act(async () => { await Promise.resolve(); });
    expect(result.current.permissionDenied).toBe(true);
    expect(result.current.hasPermission).toBe(false);
  });
});

describe('useVoiceMirror — phase transitions', () => {
  async function setupWithPermission() {
    const ctx = setup();
    await act(async () => { await Promise.resolve(); });
    return ctx;
  }

  it('starts in idle phase', async () => {
    const { result } = await setupWithPermission();
    expect(result.current.phase).toBe('idle');
  });

  it('transitions idle → recording after sustained voice', async () => {
    const { result, recordingService } = await setupWithPermission();
    const recorder = recordingService.recorder;

    // Simulate voice chunks for longer than VOICE_ONSET_MS
    await act(async () => {
      const chunkDurationMs = 100;
      const chunksNeeded = Math.ceil(VOICE_ONSET_MS / chunkDurationMs) + 2;
      for (let i = 0; i < chunksNeeded; i++) {
        recorder.simulateChunk(makeChunk(VOICE_THRESHOLD_DB + 5, 44100, chunkDurationMs));
      }
    });

    expect(result.current.phase).toBe('recording');
  });

  it('resets idle timer when voice drops below threshold', async () => {
    const { result, recordingService } = await setupWithPermission();
    const recorder = recordingService.recorder;

    await act(async () => {
      // Send some voice, then silence before onset completes
      recorder.simulateChunk(makeChunk(VOICE_THRESHOLD_DB + 5, 44100, 100));
      recorder.simulateChunk(makeChunk(VOICE_THRESHOLD_DB - 10, 44100, 100)); // silence
    });

    expect(result.current.phase).toBe('idle');
  });

  it('starts encoding when recording phase begins', async () => {
    const { result, recordingService, encoderService } = await setupWithPermission();
    const recorder = recordingService.recorder;

    await act(async () => {
      const chunkDurationMs = 100;
      const chunksNeeded = Math.ceil(VOICE_ONSET_MS / chunkDurationMs) + 2;
      for (let i = 0; i < chunksNeeded; i++) {
        recorder.simulateChunk(makeChunk(VOICE_THRESHOLD_DB + 5, 44100, chunkDurationMs));
      }
    });

    expect(encoderService.startEncoding).toHaveBeenCalledOnce();
    expect(encoderService.startEncoding).toHaveBeenCalledWith(
      expect.stringContaining('.m4a'),
      44100,
    );
  });
});

describe('useVoiceMirror — pause/resume', () => {
  it('transitions to paused when togglePause called in idle', async () => {
    const { result } = setup();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { result.current.togglePause(); });
    expect(result.current.phase).toBe('paused');
  });

  it('returns to idle when togglePause called in paused', async () => {
    const { result } = setup();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { result.current.togglePause(); });
    await act(async () => { result.current.togglePause(); });
    expect(result.current.phase).toBe('idle');
  });
});
```

---

### Example: `useRecordings` tests

```typescript
// src/hooks/__tests__/useRecordings.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { useRecordings } from '../useRecordings';
import { StubRecordingsRepository } from '../../__tests__/stubs/stubRecordingsRepository';
import { StubAudioDecoderService } from '../../__tests__/stubs/stubAudioDecoderService';
import { makeStubAudioContext } from '../../__tests__/stubs/stubAudioContext';
import type { Recording } from '../../lib/recordings';

function makeRecording(overrides?: Partial<Recording>): Recording {
  return {
    id: '1',
    filePath: 'file:///tmp/recording_1.m4a',
    recordedAt: new Date().toISOString(),
    durationMs: 2000,
    ...overrides,
  };
}

function setup(initialRecordings: Recording[] = []) {
  const repository = new StubRecordingsRepository();
  repository.seed(initialRecordings);

  const decoderService = new StubAudioDecoderService();
  const audioContext = makeStubAudioContext();
  const onWillPlay = jest.fn().mockResolvedValue(undefined);
  const onDidStop  = jest.fn().mockResolvedValue(undefined);

  const { result } = renderHook(() =>
    useRecordings({ onWillPlay, onDidStop }, audioContext, repository, decoderService),
  );

  return { result, repository, decoderService, audioContext, onWillPlay, onDidStop };
}

describe('useRecordings — initial load', () => {
  it('loads saved recordings on mount', async () => {
    const initial = [makeRecording({ id: '1' }), makeRecording({ id: '2' })];
    const { result } = setup(initial);

    await act(async () => { await Promise.resolve(); });
    expect(result.current.recordings).toHaveLength(2);
  });
});

describe('useRecordings — addRecording', () => {
  it('prepends a new recording and persists it', async () => {
    const { result, repository } = setup();
    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.addRecording('/tmp/new.m4a', 1500); });

    expect(result.current.recordings).toHaveLength(1);
    expect(result.current.recordings[0].durationMs).toBe(1500);
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('adds file:// prefix to filePath', async () => {
    const { result } = setup();
    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.addRecording('/tmp/new.m4a', 1000); });

    expect(result.current.recordings[0].filePath).toBe('file:///tmp/new.m4a');
  });
});

describe('useRecordings — togglePlay', () => {
  it('calls onWillPlay before starting playback', async () => {
    const recording = makeRecording();
    const { result, onWillPlay } = setup([recording]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { result.current.togglePlay(recording); });

    expect(onWillPlay).toHaveBeenCalledOnce();
  });

  it('decodes the file with the audioContext sample rate', async () => {
    const recording = makeRecording();
    const { result, decoderService, audioContext } = setup([recording]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { result.current.togglePlay(recording); });

    expect(decoderService.decodeAudioData).toHaveBeenCalledWith(
      recording.filePath,
      audioContext.sampleRate,
    );
  });

  it('sets playState to isPlaying', async () => {
    const recording = makeRecording();
    const { result } = setup([recording]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { result.current.togglePlay(recording); });

    expect(result.current.playState).toEqual({ recordingId: recording.id, isPlaying: true });
  });

  it('stops playback and calls onDidStop when toggled again', async () => {
    const recording = makeRecording();
    const { result, onDidStop } = setup([recording]);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { result.current.togglePlay(recording); });
    act(() => { result.current.togglePlay(recording); });

    expect(onDidStop).toHaveBeenCalledOnce();
    expect(result.current.playState).toBeNull();
  });
});
```

---

### Example: `lib/recordings.ts` tests

These mock `expo-file-system` at the module level.

```typescript
// src/lib/__tests__/recordings.test.ts
jest.mock('expo-file-system', () => {
  const store: Record<string, string> = {};
  return {
    Paths: { document: '/mock/documents' },
    Directory: class {
      constructor(public parent: string, public name: string) {}
      get exists() { return true; }
      create = jest.fn();
    },
    File: class {
      private key: string;
      constructor(parent: any, name?: string) {
        // handle both new File(dir, name) and new File('file://...')
        this.key = name ? `${parent.parent}/${parent.name}/${name}` : String(parent);
      }
      get uri() { return 'file://' + this.key; }
      get exists() { return this.key in store; }
      get text() { return Promise.resolve(store[this.key] ?? '[]'); }
      write(content: string) { store[this.key] = content; }
      delete() { delete store[this.key]; }
    },
  };
});

import { loadRecordings, saveRecordings, newFilePath } from '../recordings';

describe('loadRecordings', () => {
  it('returns empty array when index.json does not exist', async () => {
    const result = await loadRecordings();
    expect(result).toEqual([]);
  });
});

describe('saveRecordings + loadRecordings round-trip', () => {
  it('persists and retrieves recordings', async () => {
    const recordings = [{ id: '1', filePath: 'file:///a.m4a', recordedAt: '2026-01-01', durationMs: 1000 }];
    saveRecordings(recordings);
    const loaded = await loadRecordings();
    expect(loaded).toEqual(recordings);
  });
});

describe('newFilePath', () => {
  it('returns a path ending in .m4a', () => {
    const path = newFilePath();
    expect(path).toMatch(/\.m4a$/);
  });

  it('returns unique paths on successive calls', () => {
    const p1 = newFilePath();
    const p2 = newFilePath();
    expect(p1).not.toBe(p2);
  });
});
```

---

### Example: Component tests

```typescript
// src/components/__tests__/PhaseDisplay.test.tsx
import { render, screen } from '@testing-library/react-native';
import { PhaseDisplay } from '../PhaseDisplay';

describe('PhaseDisplay', () => {
  it('shows "Listening…" in idle phase', () => {
    render(<PhaseDisplay phase="idle" />);
    expect(screen.getByText('Listening…')).toBeTruthy();
  });

  it('shows "Recording" in recording phase', () => {
    render(<PhaseDisplay phase="recording" />);
    expect(screen.getByText('Recording')).toBeTruthy();
  });

  it('shows "Playing back" in playing phase', () => {
    render(<PhaseDisplay phase="playing" />);
    expect(screen.getByText('Playing back')).toBeTruthy();
  });

  it('shows "Paused" in paused phase', () => {
    render(<PhaseDisplay phase="paused" />);
    expect(screen.getByText('Paused')).toBeTruthy();
  });
});
```

---

## File Structure After Refactoring

```
src/
  services/
    AudioRecordingService.ts     # IAudioRecordingService + RealAudioRecordingService
    AudioEncoderService.ts       # IAudioEncoderService + RealAudioEncoderService
    AudioDecoderService.ts       # IAudioDecoderService + RealAudioDecoderService
  repositories/
    RecordingsRepository.ts      # IRecordingsRepository + RealRecordingsRepository
  context/
    AudioContextProvider.tsx     # unchanged
    ServicesProvider.tsx         # new — provides all services via React context
  hooks/
    useVoiceMirror.ts            # refactored to accept injected services
    useRecordings.ts             # refactored to accept injected services
    types.ts                     # unchanged
  lib/
    recordings.ts                # unchanged (wrapped by RealRecordingsRepository)
  components/                    # unchanged
  screens/
    VoiceMirrorScreen.tsx        # reads services from useServices(), passes to hooks
  __tests__/
    stubs/
      stubAudioRecordingService.ts
      stubAudioEncoderService.ts
      stubAudioDecoderService.ts
      stubRecordingsRepository.ts
      stubAudioContext.ts
```

---

## Implementation Order

1. Install Jest deps and configure `package.json` — verify `pnpm test` runs (even with 0 tests)
2. Create all interface files (`services/`, `repositories/`)
3. Create real implementations in the same files
4. Create `ServicesProvider` context
5. Refactor `useVoiceMirror` — pass services as args
6. Refactor `useRecordings` — pass services as args
7. Update `VoiceMirrorScreen` to call `useServices()` and pass to hooks
8. Update `App.tsx` to wire real implementations into `ServicesProvider`
9. Run `pnpm typecheck` to verify no type errors
10. Create stub files under `src/__tests__/stubs/`
11. Write tests in order: `lib/recordings.ts` → components → `useRecordings` → `useVoiceMirror`
12. Run `pnpm test:ci` — all green

---

## Todo List

### Phase A: Jest Infrastructure

- [x] Install dev dependencies: `npx expo install jest-expo jest @types/jest @testing-library/react-native --dev`
- [x] Add `"test"` and `"test:ci"` scripts to `package.json`
- [x] Add `"jest"` config block to `package.json` with `preset` and `transformIgnorePatterns`
- [x] Verify the test runner works: `pnpm test:ci` with no test files exits cleanly (or 0 suites pass)

### Phase B: Service & Repository Interfaces

- [x] Create `src/services/AudioRecordingService.ts` — define `AudioChunkEvent`, `IAudioRecorder`, `IAudioRecordingService` interfaces
- [x] Create `src/services/AudioEncoderService.ts` — define `IAudioEncoderService` interface
- [x] Create `src/services/AudioDecoderService.ts` — define `IAudioDecoderService` interface
- [x] Create `src/repositories/RecordingsRepository.ts` — define `IRecordingsRepository` interface

### Phase C: Real Implementations

- [x] Implement `RealAudioRecordingService` in `src/services/AudioRecordingService.ts`
  - [x] `requestRecordingPermissions()` delegates to `AudioManager`
  - [x] `setAudioSessionOptions()` delegates to `AudioManager`
  - [x] `setAudioSessionActivity()` delegates to `AudioManager`
  - [x] `createRecorder()` returns a `RealAudioRecorder` instance
  - [x] `RealAudioRecorder.onAudioReady()` extracts `Float32Array` via `buffer.copyFromChannel()` before calling the callback (hiding the raw `AudioBuffer` from callers)
- [x] Implement `RealAudioEncoderService` in `src/services/AudioEncoderService.ts` — delegates all three methods to `AudioEncoder` native module
- [x] Implement `RealAudioDecoderService` in `src/services/AudioDecoderService.ts` — delegates to `decodeAudioData` from `react-native-audio-api`
- [x] Implement `RealRecordingsRepository` in `src/repositories/RecordingsRepository.ts`
  - [x] `load()` delegates to `loadRecordings()` from `lib/recordings`
  - [x] `save()` delegates to `saveRecordings()` from `lib/recordings`
  - [x] `newFilePath()` delegates to `newFilePath()` from `lib/recordings`
  - [x] `deleteFile()` creates a `new File('file://' + path)` and calls `.delete()`

### Phase D: Services Context

- [x] Create `src/context/ServicesProvider.tsx`
  - [x] Define the `Services` type bundling all four interfaces
  - [x] Implement `ServicesProvider` component that takes a `services` prop and provides via context
  - [x] Implement `useServices()` hook that reads from context (throws if used outside provider)
- [x] Update `App.tsx`
  - [x] Instantiate all four real service/repository objects at module level (outside the component)
  - [x] Wrap `<VoiceMirrorScreen>` with `<ServicesProvider services={realServices}>`

### Phase E: Refactor `useVoiceMirror`

- [x] Change the function signature to accept `audioContext`, `recordingService`, `encoderService`, `repository` as parameters
- [x] Remove `useAudioContext()` call inside the hook; use the `audioContext` parameter directly
- [x] Remove `import { AudioRecorder, AudioManager } from 'react-native-audio-api'`
- [x] Remove `import AudioEncoder from 'audio-encoder'`
- [x] Remove `import { File } from 'expo-file-system'`
- [x] Remove `import { newFilePath } from '../lib/recordings'`
- [x] Change `audioRecorderRef` type from `AudioRecorder | null` to `IAudioRecorder | null`
- [x] Replace `new AudioRecorder()` with `recordingService.createRecorder()`
- [x] Replace all `AudioManager.*` calls with `recordingService.*` equivalents
- [x] In `startMonitoring()`, update the `onAudioReady` callback signature from `({ buffer, numFrames })` to `({ chunk, numFrames })` — remove the `buffer.copyFromChannel` line
- [x] In `beginEncoding()`, replace `newFilePath()` with `repository.newFilePath()` and `AudioEncoder.startEncoding/encodeChunk` with `encoderService.*`
- [x] In `stopAndPlay()`, replace `AudioEncoder.stopEncoding()` with `encoderService.stopEncoding()` and `new File(...).delete()` with `repository.deleteFile(filePath)`
- [x] In `startMonitoring()`, replace `AudioEncoder.encodeChunk(chunk)` with `encoderService.encodeChunk(chunk)` inside the `onAudioReady` callback
- [x] Add `recordingService` to the `useEffect` dependency array

### Phase F: Refactor `useRecordings`

- [x] Change the function signature to accept `audioContext`, `repository`, `decoderService` as parameters (after `options`)
- [x] Remove `useAudioContext()` call; use the `audioContext` parameter directly
- [x] Remove `import { decodeAudioData } from 'react-native-audio-api'`
- [x] Remove `import { loadRecordings, saveRecordings } from '../lib/recordings'`
- [x] In `useEffect`, replace `loadRecordings()` with `repository.load()`
- [x] In `addRecording()`, replace `saveRecordings(next)` with `repository.save(next)`
- [x] In `togglePlay()`, replace `decodeAudioData(...)` with `decoderService.decodeAudioData(...)`
- [x] Replace `ctx` with `audioContext` throughout
- [x] Add `repository` to the `useEffect` dependency array

### Phase G: Update `VoiceMirrorScreen`

- [x] Import `useAudioContext` and `useServices` at the top of the file
- [x] In `VoiceMirrorContent`, call `useAudioContext()` to get `audioContext`
- [x] In `VoiceMirrorContent`, call `useServices()` to destructure all four services
- [x] Pass `audioContext`, `recordingService`, `encoderService`, `recordingsRepository` to `useVoiceMirror`
- [x] Pass `audioContext`, `recordingsRepository`, `decoderService` to `useRecordings`

### Phase H: Type Check

- [x] Run `pnpm typecheck` — resolve any type errors before proceeding to tests

### Phase I: Stub Implementations

- [x] Create `src/__tests__/stubs/stubAudioRecordingService.ts`
  - [x] `StubAudioRecorder` with `jest.fn()` for `start`, `stop`, `clearOnAudioReady`
  - [x] `StubAudioRecorder.onAudioReady()` stores the callback
  - [x] `StubAudioRecorder.simulateChunk(chunk)` fires the stored callback — this is the primary test driver
  - [x] `StubAudioRecordingService` with `jest.fn()` for `requestRecordingPermissions` (default: resolves `'Granted'`), `setAudioSessionOptions`, `setAudioSessionActivity`, `createRecorder`
- [x] Create `src/__tests__/stubs/stubAudioEncoderService.ts`
  - [x] `jest.fn()` for `startEncoding`, `encodeChunk`
  - [x] `stopEncoding` resolves to `1000` by default
- [x] Create `src/__tests__/stubs/stubAudioDecoderService.ts`
  - [x] `makeStubAudioBuffer(length?)` helper that returns a minimal `AudioBuffer`-shaped object
  - [x] `StubAudioDecoderService.decodeAudioData` resolves to `makeStubAudioBuffer()` by default
- [x] Create `src/__tests__/stubs/stubRecordingsRepository.ts`
  - [x] In-memory `data` array backing `load` and `save`
  - [x] `seed(recordings)` helper to pre-populate data before a test
  - [x] `newFilePath` returns incrementing `/tmp/recording_N.m4a` paths
  - [x] `deleteFile` is a `jest.fn()`
- [x] Create `src/__tests__/stubs/stubAudioContext.ts`
  - [x] `makeStubAudioContext(sampleRate?)` returns an object with `jest.fn()` for `createBuffer`, `createBufferSource`, `resume`, `suspend`, `close`
  - [x] `createBufferSource` returns a stub source node with `jest.fn()` for `connect`, `start`, `stop` and a writable `onEnded`

### Phase J: Write Tests

#### `lib/recordings.ts`
- [x] Create `src/lib/__tests__/recordings.test.ts`
- [x] Add module-level `jest.mock('expo-file-system', ...)` with an in-memory `File` and `Directory` implementation
- [x] Test `loadRecordings()` returns `[]` when `index.json` does not exist
- [x] Test `saveRecordings()` + `loadRecordings()` round-trip restores the same data
- [x] Test `newFilePath()` returns a string ending in `.m4a`
- [x] Test `newFilePath()` returns a different path on successive calls

#### Components
- [x] Create `src/components/__tests__/PhaseDisplay.test.tsx`
  - [x] Test each of the four phase labels renders correctly
- [x] Create `src/components/__tests__/AudioLevelMeter.test.tsx`
  - [x] Test it renders 40 bars (or the correct number from `LEVEL_HISTORY_SIZE`)
  - [x] Test it renders without crashing for each phase value
- [x] Create `src/components/__tests__/RecordingItem.test.tsx`
  - [x] Test play button renders when not playing
  - [x] Test stop button renders when playing
  - [x] Test formatted duration appears
  - [x] Test `onTogglePlay` is called when the button is pressed
  - [x] Test button is disabled when `disabled` prop is true

#### `useRecordings`
- [x] Create `src/hooks/__tests__/useRecordings.test.ts`
- [x] Test recordings are loaded from repository on mount
- [x] Test `addRecording()` prepends the entry to the list
- [x] Test `addRecording()` adds `file://` prefix to the filePath
- [x] Test `addRecording()` calls `repository.save()` with the updated list
- [x] Test `togglePlay()` calls `onWillPlay()` before decoding
- [x] Test `togglePlay()` calls `decoderService.decodeAudioData()` with the correct filePath and sampleRate
- [x] Test `togglePlay()` sets `playState` to `{ recordingId, isPlaying: true }`
- [x] Test `togglePlay()` on the currently playing recording calls `onDidStop()` and clears `playState`
- [x] Test `togglePlay()` is a no-op while decoding is in progress (`isDecodingRef` guard)
- [x] Test `togglePlay()` calls `onDidStop()` and clears `playState` when `decodeAudioData` rejects

#### `useVoiceMirror`
- [x] Create `src/hooks/__tests__/useVoiceMirror.test.ts`
- [x] **Permissions**
  - [x] Test `hasPermission` is `false` before the effect runs
  - [x] Test `hasPermission` becomes `true` after permission is granted
  - [x] Test `permissionDenied` becomes `true` when permission is `'Denied'`
  - [x] Test `setAudioSessionOptions` is called once after permission is granted
  - [x] Test `createRecorder` is called once after permission is granted
- [x] **Phase: idle → recording**
  - [x] Test phase stays `idle` when all audio chunks are below `VOICE_THRESHOLD_DB`
  - [x] Test voice onset resets if audio drops below threshold before `VOICE_ONSET_MS`
  - [x] Test phase transitions to `recording` after sustained audio above `VOICE_THRESHOLD_DB` for `VOICE_ONSET_MS`
  - [x] Test `encoderService.startEncoding()` is called exactly once when recording begins
  - [x] Test pre-voice chunks are retroactively fed to `encoderService.encodeChunk()` in `beginEncoding`
- [x] **Phase: recording → playing**
  - [x] Test phase transitions to `playing` after silence longer than `SILENCE_DURATION_MS` with recording longer than `MIN_RECORDING_MS`
  - [x] Test phase does not transition to `playing` if recording is shorter than `MIN_RECORDING_MS`
  - [x] Test `encoderService.stopEncoding()` is awaited when transitioning to playing
  - [x] Test `onRecordingComplete` is called with the filePath and durationMs when encoding succeeds
  - [x] Test `repository.deleteFile()` is called and `onRecordingComplete` is NOT called when `stopEncoding` returns `0`
  - [x] Test `recordingError` is set when encoding returns `0` duration
- [x] **Phase: pause / resume**
  - [x] Test `togglePause()` transitions any non-paused phase to `paused`
  - [x] Test `togglePause()` calls `recordingService.setAudioSessionActivity(false)` when pausing
  - [x] Test `togglePause()` from `paused` transitions back to `idle`
  - [x] Test `levelHistory` is zeroed out when paused
- [x] **List playback coordination**
  - [x] Test `suspendForListPlayback()` stops the recorder and sets phase to `idle`
  - [x] Test `resumeFromListPlayback()` calls `startMonitoring` when not user-paused
  - [x] Test `resumeFromListPlayback()` stays `paused` when user had explicitly paused before list playback

### Phase K: Final Validation

- [x] Run `pnpm typecheck` — no errors
- [x] Run `pnpm lint` — no warnings
- [x] Run `pnpm test:ci` — all tests pass
