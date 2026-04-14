import type { AudioContext, AudioBuffer } from "react-native-audio-api";
import { makeStubAudioBuffer } from "./stubAudioDecoderService";

export type StubAudioBufferSourceNode = {
  buffer: AudioBuffer | null;
  connect: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  onEnded: (() => void) | null;
};

export function makeStubBufferSourceNode(): StubAudioBufferSourceNode {
  return {
    buffer: null,
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    onEnded: null,
  };
}

export function makeStubAudioContext(sampleRate = 44100): AudioContext {
  return {
    sampleRate,
    destination: {} as AudioContext["destination"],
    createBuffer: jest.fn(() => makeStubAudioBuffer(sampleRate, sampleRate)),
    createBufferSource: jest.fn(() => makeStubBufferSourceNode()),
    resume: jest.fn().mockResolvedValue(undefined),
    suspend: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as AudioContext;
}
