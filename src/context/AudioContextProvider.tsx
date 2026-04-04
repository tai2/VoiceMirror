import { createContext, useContext, useEffect, useState } from 'react';
import { AudioContext } from 'react-native-audio-api';

const Ctx = createContext<AudioContext | null>(null);

export function AudioContextProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<AudioContext | null>(null);

  useEffect(() => {
    // Omit sampleRate to use device-native rate and avoid resampling click artifacts
    const context = new AudioContext();
    setCtx(context);
    return () => { void context.close(); };
  }, []);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useAudioContext(): AudioContext | null {
  return useContext(Ctx);
}
