import { requireNativeModule } from 'expo';

interface AudioEncoderNativeModule {
  startEncoding(filePath: string, sampleRate: number): void;
  encodeChunk(samples: Float32Array): void;
  stopEncoding(): Promise<number>;
}

export default requireNativeModule<AudioEncoderNativeModule>('AudioEncoder');
