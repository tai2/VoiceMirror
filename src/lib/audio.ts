import { DB_FLOOR, DB_CEIL } from '../constants/audio';

export function computeNormalizedLevel(
  samples: Float32Array,
  startFrame: number,
  numFrames: number,
): number {
  let sumSq = 0;
  const end = startFrame + numFrames;
  for (let i = startFrame; i < end; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / numFrames);
  const db = 20 * Math.log10(Math.max(rms, 1e-10));
  return Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
}
