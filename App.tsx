import { StatusBar } from 'expo-status-bar';
import { VoiceMirrorScreen } from './src/screens/VoiceMirrorScreen';

export default function App() {
  return (
    <>
      <VoiceMirrorScreen />
      <StatusBar style="dark" />
    </>
  );
}
