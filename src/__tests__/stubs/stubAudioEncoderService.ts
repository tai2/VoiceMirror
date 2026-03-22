import type { IAudioEncoderService } from '../../services/AudioEncoderService';

export class StubAudioEncoderService implements IAudioEncoderService {
  startEncoding: jest.Mock<void, [string, number]> = jest.fn();
  encodeChunk: jest.Mock<void, [Float32Array]> = jest.fn();
  stopEncoding: jest.Mock<Promise<number>> = jest.fn().mockResolvedValue(1000);
}
