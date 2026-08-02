export { MAX_WAVEFORM_DECODE_BYTES } from "../../electron/media/types";
import { MAX_WAVEFORM_DECODE_BYTES } from "../../electron/media/types";

export const MAX_WAVEFORM_DURATION_SECONDS = 10 * 60;

export function shouldDecodeWaveform(
  sizeBytes: number,
  durationSeconds: number,
): boolean {
  return (
    Number.isFinite(sizeBytes) &&
    sizeBytes > 0 &&
    sizeBytes <= MAX_WAVEFORM_DECODE_BYTES &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0 &&
    durationSeconds <= MAX_WAVEFORM_DURATION_SECONDS
  );
}

export function summarizeWaveform(
  channels: readonly Float32Array[],
  requestedBarCount: number,
): number[] {
  const barCount = Number.isFinite(requestedBarCount) && requestedBarCount > 0
    ? Math.floor(requestedBarCount)
    : 1;
  const sampleCount = channels.reduce(
    (length, channel) => Math.min(length, channel.length),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(sampleCount) || sampleCount === 0) {
    return Array.from({ length: barCount }, () => 0.08);
  }

  const peaks = Array.from({ length: barCount }, (_, index) => {
    const start = Math.min(
      sampleCount - 1,
      Math.floor(index * sampleCount / barCount),
    );
    const end = Math.min(
      sampleCount,
      Math.max(start + 1, Math.floor((index + 1) * sampleCount / barCount)),
    );
    const stride = Math.max(1, Math.floor((end - start) / 256));
    let peak = 0;
    for (const channel of channels) {
      for (let sample = start; sample < end; sample += stride) {
        peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
      }
    }
    return peak;
  });
  const highest = Math.max(...peaks);
  if (highest === 0) return peaks.map(() => 0.08);
  return peaks.map((peak) => Math.max(0.08, Math.sqrt(peak / highest)));
}
