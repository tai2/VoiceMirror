import { createContext, useContext, useEffect, useState } from 'react';
import { AudioContext } from 'react-native-audio-api';
import { SAMPLE_RATE } from '../constants/audio';

const Ctx = createContext<AudioContext | null>(null);

export function AudioContextProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<AudioContext | null>(null);

  useEffect(() => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    setCtx(context);
    return () => { void context.close(); };
  }, []);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useAudioContext(): AudioContext | null {
  return useContext(Ctx);
}
