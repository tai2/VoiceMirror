import { computeNormalizedLevel, computeLevel, dbToNormalized } from "../audio";
import { DB_FLOOR, DB_CEIL } from "../../constants/audio";

describe("computeNormalizedLevel", () => {
  it("returns 0 for silence (all zeros)", () => {
    const samples = new Float32Array(4096);
    expect(computeNormalizedLevel(samples, 0, 4096)).toBe(0);
  });

  it("returns 1 for full-scale signal (all 1.0)", () => {
    const samples = new Float32Array(4096).fill(1.0);
    expect(computeNormalizedLevel(samples, 0, 4096)).toBe(1);
  });

  it("returns a value between 0 and 1 for intermediate amplitude", () => {
    const samples = new Float32Array(4096).fill(0.01);
    const result = computeNormalizedLevel(samples, 0, 4096);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it("only reads the specified slice via startFrame/numFrames", () => {
    const samples = new Float32Array(8192);
    // Fill first half with silence, second half with loud signal
    for (let i = 4096; i < 8192; i++) samples[i] = 1.0;

    const silenceResult = computeNormalizedLevel(samples, 0, 4096);
    const loudResult = computeNormalizedLevel(samples, 4096, 4096);

    expect(silenceResult).toBe(0);
    expect(loudResult).toBe(1);
  });

  it("clamps values below DB_FLOOR to 0", () => {
    // Very quiet signal well below DB_FLOOR (-70 dB)
    const samples = new Float32Array(4096).fill(1e-6);
    expect(computeNormalizedLevel(samples, 0, 4096)).toBe(0);
  });

  it("clamps values above DB_CEIL to 1", () => {
    // Full scale signal is 0 dB, well above DB_CEIL (-10 dB)
    const samples = new Float32Array(4096).fill(1.0);
    expect(computeNormalizedLevel(samples, 0, 4096)).toBe(1);
  });
});

describe("computeLevel", () => {
  it("returns both normalized and db values", () => {
    const samples = new Float32Array(4096).fill(0.01);
    const result = computeLevel(samples, 0, 4096);
    expect(result).toHaveProperty("normalized");
    expect(result).toHaveProperty("db");
    expect(result.normalized).toBeGreaterThan(0);
    expect(result.normalized).toBeLessThan(1);
    expect(result.db).toBeCloseTo(-40, 0);
  });

  it("returns 0 dB for full-scale signal", () => {
    const samples = new Float32Array(4096).fill(1.0);
    const result = computeLevel(samples, 0, 4096);
    expect(result.normalized).toBe(1);
    expect(result.db).toBeCloseTo(0, 1);
  });

  it("returns very low dB for silence", () => {
    const samples = new Float32Array(4096);
    const result = computeLevel(samples, 0, 4096);
    expect(result.normalized).toBe(0);
    expect(result.db).toBeLessThan(DB_FLOOR);
  });

  it("matches computeNormalizedLevel for normalized value", () => {
    const samples = new Float32Array(4096).fill(0.05);
    const level = computeLevel(samples, 0, 4096);
    const normalized = computeNormalizedLevel(samples, 0, 4096);
    expect(level.normalized).toBe(normalized);
  });
});

describe("dbToNormalized", () => {
  it("returns 0 for values at DB_FLOOR", () => {
    expect(dbToNormalized(DB_FLOOR)).toBe(0);
  });

  it("returns 1 for values at DB_CEIL", () => {
    expect(dbToNormalized(DB_CEIL)).toBe(1);
  });

  it("clamps values below DB_FLOOR to 0", () => {
    expect(dbToNormalized(DB_FLOOR - 20)).toBe(0);
  });

  it("clamps values above DB_CEIL to 1", () => {
    expect(dbToNormalized(DB_CEIL + 20)).toBe(1);
  });

  it("returns mid-range value for midpoint dB", () => {
    const midDb = (DB_FLOOR + DB_CEIL) / 2;
    expect(dbToNormalized(midDb)).toBeCloseTo(0.5, 5);
  });
});
