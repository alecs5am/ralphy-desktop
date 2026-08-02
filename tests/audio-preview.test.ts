import { describe, expect, test } from "vitest";
import {
  MAX_WAVEFORM_DECODE_BYTES,
  MAX_WAVEFORM_DURATION_SECONDS,
  shouldDecodeWaveform,
  summarizeWaveform,
} from "../src/lib/audio-preview";

describe("audio preview policy", () => {
  test("decodes bounded generated audio into a waveform", () => {
    expect(shouldDecodeWaveform(4 * 1024 * 1024, 90)).toBe(true);
  });

  test("streams large or long audio without decoding the complete file", () => {
    expect(shouldDecodeWaveform(MAX_WAVEFORM_DECODE_BYTES + 1, 90)).toBe(false);
    expect(shouldDecodeWaveform(1024, MAX_WAVEFORM_DURATION_SECONDS + 1)).toBe(false);
    expect(shouldDecodeWaveform(1024, Number.NaN)).toBe(false);
  });

  test("summarizes real channel samples into normalized thumbnail bars", () => {
    const bars = summarizeWaveform([
      Float32Array.from([0, 0, 0.4, 0.4, 1, 1, 0.2, 0.2]),
    ], 4);

    expect(bars).toHaveLength(4);
    expect(bars[2]).toBe(1);
    expect(bars[0]).toBeLessThan(bars[1]);
    expect(bars[3]).toBeLessThan(bars[1]);
    expect(summarizeWaveform([
      Float32Array.from([1, 1, 0, 0, 0.2, 0.2, 0.8, 0.8]),
    ], 4)).not.toEqual(bars);
  });
});
