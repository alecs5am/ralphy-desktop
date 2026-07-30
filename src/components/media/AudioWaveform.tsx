import {
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type WaveSurfer from "wavesurfer.js";
import { bridge } from "../../lib/ipc";
import {
  MAX_WAVEFORM_DECODE_BYTES,
  shouldDecodeWaveform,
} from "../../lib/audio-preview";
import { SnappySlider } from "../ui/SnappySlider";

interface AudioWaveformProps {
  src: string;
  path: string;
  name: string;
  sizeBytes: number;
  compact?: boolean;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole % 60).toString().padStart(2, "0")}`;
}

function streamBars(name: string, count: number): number[] {
  let seed = Array.from(name).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    2166136261,
  );
  return Array.from({ length: count }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return 20 + (seed % 76);
  });
}

function StreamingAudioPlayer({
  src,
  name,
  compact,
  probing,
  onMetadata,
}: {
  src: string;
  name: string;
  compact: boolean;
  probing: boolean;
  onMetadata?(duration: number): void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bars = useMemo(
    () => streamBars(name, compact ? 44 : 96),
    [compact, name],
  );
  const progress = duration > 0 ? currentTime / duration : 0;

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setError("This audio cannot be played."));
    } else {
      audio.pause();
    }
  };

  const seek = (next: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(duration, Math.max(0, next));
    setCurrentTime(audio.currentTime);
  };

  return (
    <div className={`audio-waveform-player audio-stream-player${compact ? " is-compact" : ""}`}>
      <audio
        ref={audioRef}
        className="audio-stream-element"
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(nextDuration);
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
          setReady(true);
          onMetadata?.(nextDuration);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
        onError={() => setError("This audio cannot be played.")}
      />
      <div className="audio-waveform-heading">
        <button
          className="audio-play-button"
          type="button"
          aria-label={playing ? "Pause audio" : "Play audio"}
          disabled={!ready || probing}
          onClick={togglePlayback}
        >
          {playing
            ? <Pause size={compact ? 16 : 21} fill="currentColor" />
            : <Play size={compact ? 16 : 21} fill="currentColor" />}
        </button>
        <span>
          <strong>{name}</strong>
          <small>
            {probing
              ? "Checking audio…"
              : error
                ? "Preview unavailable"
                : ready
                  ? `${formatTime(duration)} · streaming preview`
                  : "Loading audio…"}
          </small>
        </span>
      </div>
      <div className="audio-stream-waveform">
        <div className="audio-stream-bars" aria-hidden="true">
          {bars.map((height, index) => (
            <i
              className={index / bars.length <= progress ? "is-played" : ""}
              key={index}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <SnappySlider
          className="audio-stream-seek"
          value={currentTime}
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.1}
          ariaLabel="Audio position"
          disabled={!ready || probing}
          onValueChange={seek}
        />
      </div>
      {!compact && (
        <div className="audio-waveform-controls">
          <span>{formatTime(currentTime)}</span>
          <button type="button" aria-label="Back 10 seconds" title="Back 10 seconds" disabled={!ready} onClick={() => seek(currentTime - 10)}>
            <RotateCcw size={15} />
          </button>
          <button type="button" aria-label="Forward 10 seconds" title="Forward 10 seconds" disabled={!ready} onClick={() => seek(currentTime + 10)}>
            <RotateCw size={15} />
          </button>
          <button
            type="button"
            aria-label={muted ? "Unmute audio" : "Mute audio"}
            title={muted ? "Unmute" : "Mute"}
            disabled={!ready}
            onClick={() => {
              if (audioRef.current) audioRef.current.muted = !muted;
            }}
          >
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <SnappySlider
            className="volume-slider"
            value={muted ? 0 : volume}
            min={0}
            max={1}
            step={0.05}
            ariaLabel="Audio volume"
            disabled={!ready}
            onValueChange={(next) => {
              if (!audioRef.current) return;
              audioRef.current.volume = next;
              audioRef.current.muted = false;
            }}
          />
          <span>{formatTime(duration)}</span>
        </div>
      )}
      {error && <span className="audio-waveform-error">{error}</span>}
    </div>
  );
}

function DecodedAudioWaveform({
  src,
  name,
  compact,
  onFallback,
}: {
  src: string;
  name: string;
  compact: boolean;
  onFallback(): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let wave: WaveSurfer | null = null;
    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setError(null);

    void import("wavesurfer.js").then(({ default: WaveSurfer }) => {
      if (disposed || !containerRef.current) return;
      wave = WaveSurfer.create({
        container: containerRef.current,
        url: src,
        height: compact ? 56 : 164,
        waveColor: "#555555",
        progressColor: "#9b8df8",
        cursorColor: "#f4f4f4",
        cursorWidth: 1,
        barWidth: compact ? 2 : 3,
        barGap: compact ? 2 : 3,
        barRadius: 3,
        barMinHeight: 2,
        normalize: true,
        interact: true,
        dragToSeek: true,
        hideScrollbar: true,
        autoScroll: false,
      });
      waveRef.current = wave;
      wave.on("ready", (nextDuration) => {
        setDuration(nextDuration);
        setReady(true);
      });
      wave.on("timeupdate", setCurrentTime);
      wave.on("play", () => setPlaying(true));
      wave.on("pause", () => setPlaying(false));
      wave.on("finish", () => setPlaying(false));
      wave.on("error", onFallback);
    }).catch(() => {
      if (!disposed) onFallback();
    });

    return () => {
      disposed = true;
      if (waveRef.current === wave) waveRef.current = null;
      wave?.destroy();
    };
  }, [compact, onFallback, src]);

  const seek = (next: number) => {
    const wave = waveRef.current;
    if (!wave) return;
    const bounded = Math.min(duration, Math.max(0, next));
    wave.setTime(bounded);
    setCurrentTime(bounded);
  };

  const onTimelineKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = currentTime - 5;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = currentTime + 5;
    if (event.key === "PageDown") next = currentTime - 30;
    if (event.key === "PageUp") next = currentTime + 30;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = duration;
    if (next === null) return;
    event.preventDefault();
    seek(next);
  };

  const toggleMute = () => {
    const wave = waveRef.current;
    if (!wave) return;
    const next = !muted;
    wave.setMuted(next);
    setMuted(next);
  };

  const togglePlayback = () => {
    const wave = waveRef.current;
    if (!wave) return;
    void wave.playPause().catch(() => setError("This audio cannot be played."));
  };

  return (
    <div className={`audio-waveform-player${compact ? " is-compact" : ""}`}>
      <div className="audio-waveform-heading">
        <button
          className="audio-play-button"
          type="button"
          aria-label={playing ? "Pause audio" : "Play audio"}
          disabled={!ready}
          onClick={togglePlayback}
        >
          {playing
            ? <Pause size={compact ? 16 : 21} fill="currentColor" />
            : <Play size={compact ? 16 : 21} fill="currentColor" />}
        </button>
        <span>
          <strong>{name}</strong>
          <small>{ready ? `${formatTime(duration)} audio` : error ? "Preview unavailable" : "Building waveform…"}</small>
        </span>
      </div>
      <div
        className="audio-waveform-canvas"
        ref={containerRef}
        role="slider"
        tabIndex={ready ? 0 : -1}
        aria-label="Audio position"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
        aria-disabled={!ready}
        onKeyDown={onTimelineKeyDown}
      />
      {!compact && (
        <div className="audio-waveform-controls">
          <span>{formatTime(currentTime)}</span>
          <button type="button" aria-label="Back 10 seconds" title="Back 10 seconds" disabled={!ready} onClick={() => seek(currentTime - 10)}>
            <RotateCcw size={15} />
          </button>
          <button type="button" aria-label="Forward 10 seconds" title="Forward 10 seconds" disabled={!ready} onClick={() => seek(currentTime + 10)}>
            <RotateCw size={15} />
          </button>
          <button type="button" aria-label={muted ? "Unmute audio" : "Mute audio"} title={muted ? "Unmute" : "Mute"} disabled={!ready} onClick={toggleMute}>
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <SnappySlider
            className="volume-slider"
            value={muted ? 0 : volume}
            min={0}
            max={1}
            step={0.05}
            ariaLabel="Audio volume"
            disabled={!ready}
            onValueChange={(next) => {
              waveRef.current?.setVolume(next);
              waveRef.current?.setMuted(false);
              setVolume(next);
              setMuted(false);
            }}
          />
          <span>{formatTime(duration)}</span>
        </div>
      )}
      {error && <span className="audio-waveform-error">{error}</span>}
    </div>
  );
}

export function AudioWaveform({
  src,
  path,
  name,
  sizeBytes,
  compact = false,
}: AudioWaveformProps) {
  const [mode, setMode] = useState<"probing" | "waveform" | "streaming">(
    sizeBytes <= MAX_WAVEFORM_DECODE_BYTES ? "probing" : "streaming",
  );
  const [waveformSrc, setWaveformSrc] = useState(src);
  const validationRef = useRef(0);

  useEffect(() => {
    validationRef.current += 1;
    setMode(sizeBytes <= MAX_WAVEFORM_DECODE_BYTES ? "probing" : "streaming");
    setWaveformSrc(src);
  }, [path, sizeBytes, src]);

  const fallbackToStream = useCallback(() => setMode("streaming"), []);

  const validateForWaveform = (duration: number) => {
    const request = ++validationRef.current;
    void bridge.getMediaUrl(path).then((current) => {
      if (validationRef.current !== request) return;
      if (!shouldDecodeWaveform(current.sizeBytes, duration)) {
        setMode("streaming");
        return;
      }
      const separator = current.url.includes("?") ? "&" : "?";
      setWaveformSrc(`${current.url}${separator}purpose=waveform`);
      setMode("waveform");
    }).catch(() => {
      if (validationRef.current === request) setMode("streaming");
    });
  };

  if (mode === "waveform") {
    return (
      <DecodedAudioWaveform
        src={waveformSrc}
        name={name}
        compact={compact}
        onFallback={fallbackToStream}
      />
    );
  }

  return (
    <StreamingAudioPlayer
      src={src}
      name={name}
      compact={compact}
      probing={mode === "probing"}
      onMetadata={mode === "probing"
        ? validateForWaveform
        : undefined}
    />
  );
}
