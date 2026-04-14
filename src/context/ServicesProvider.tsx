import { createContext, useContext } from "react";
import type { IAudioRecordingService } from "../services/AudioRecordingService";
import type { IAudioEncoderService } from "../services/AudioEncoderService";
import type { IAudioDecoderService } from "../services/AudioDecoderService";
import type { IRecordingsRepository } from "../repositories/RecordingsRepository";

export type Services = {
  recordingService: IAudioRecordingService;
  encoderService: IAudioEncoderService;
  decoderService: IAudioDecoderService;
  recordingsRepository: IRecordingsRepository;
};

const ServicesCtx = createContext<Services | null>(null);

export function ServicesProvider({
  children,
  services,
}: {
  children: React.ReactNode;
  services: Services;
}) {
  return (
    <ServicesCtx.Provider value={services}>{children}</ServicesCtx.Provider>
  );
}

export function useServices(): Services {
  const ctx = useContext(ServicesCtx);
  if (!ctx) throw new Error("useServices must be used inside ServicesProvider");
  return ctx;
}
