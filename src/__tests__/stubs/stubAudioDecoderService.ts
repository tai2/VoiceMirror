import type { IAudioDecoderService } from '../../services/AudioDecoderService';
import type { AudioBuffer } from 'react-native-audio-api';

export function makeStubAudioBuffer(length = 44100, sampleRate = 44100): AudioBuffer {
  return {
    length,
    duration: length / sampleRate,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: jest.fn(() => new Float32Array(length)),
    copyFromChannel: jest.fn(),
    copyToChannel: jest.fn(),
  } as unknown as AudioBuffer;
}

export class StubAudioDecoderService implements IAudioDecoderService {
  decodeAudioData: jest.Mock<Promise<AudioBuffer>, [string, number]> = jest.fn().mockResolvedValue(makeStubAudioBuffer());
}
