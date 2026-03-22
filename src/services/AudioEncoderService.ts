import AudioEncoder from 'audio-encoder';

export interface IAudioEncoderService {
  startEncoding(filePath: string, sampleRate: number): void;
  encodeChunk(samples: Float32Array): void;
  stopEncoding(): Promise<number>;
}

export class RealAudioEncoderService implements IAudioEncoderService {
  startEncoding(filePath: string, sampleRate: number): void {
    AudioEncoder.startEncoding(filePath, sampleRate);
  }

  encodeChunk(samples: Float32Array): void {
    AudioEncoder.encodeChunk(samples);
  }

  stopEncoding(): Promise<number> {
    return AudioEncoder.stopEncoding();
  }
}
