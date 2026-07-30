import { describe, expect, test } from "bun:test";
import {
  MAX_WAVEFORM_DECODE_BYTES,
  MAX_WAVEFORM_DURATION_SECONDS,
  shouldDecodeWaveform,
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
});
