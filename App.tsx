import { StatusBar } from 'expo-status-bar';
import { VoiceMirrorScreen } from './src/screens/VoiceMirrorScreen';
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
      <StatusBar style="dark" />
    </ServicesProvider>
  );
}
