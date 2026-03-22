import { decodeAudioData } from 'react-native-audio-api';
import type { AudioBuffer } from 'react-native-audio-api';

export interface IAudioDecoderService {
  decodeAudioData(filePath: string, sampleRate: number): Promise<AudioBuffer>;
}

export class RealAudioDecoderService implements IAudioDecoderService {
  decodeAudioData(filePath: string, sampleRate: number): Promise<AudioBuffer> {
    return decodeAudioData(filePath, sampleRate);
  }
}
