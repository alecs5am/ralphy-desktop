import {
  File,
  FileText,
  Film,
  Heart,
  Image,
  Music2,
  Star,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type {
  AnnotationInput,
  MediaAnnotation,
  MediaItem,
  ReviewStatus,
} from "../lib/ipc";
import { bridge } from "../lib/ipc";
import {
  MAX_WAVEFORM_DECODE_BYTES,
  summarizeWaveform,
} from "../lib/audio-preview";
import { previewScheduler } from "../lib/media";
import { AssetContextMenu } from "./AssetContextMenu";

interface AssetTileProps {
  item: MediaItem;
  annotation?: MediaAnnotation;
  selected: boolean;
  onSelect(): void;
  onOpen(): void;
  onChange(annotation: AnnotationInput): void;
  onTrash(): void;
}

const reviewDots: Record<ReviewStatus, string> = {
  Unreviewed: "idle",
  Approved: "ok",
  Shortlist: "accent",
  "Needs Work": "warn",
  Reject: "danger",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function FileGlyph({ item, size = 26 }: { item: MediaItem; size?: number }) {
  if (item.kind === "image") return <Image size={size} />;
  if (item.kind === "video") return <Film size={size} />;
  if (item.kind === "audio") return <Music2 size={size} />;
  if (item.kind === "text" || item.kind === "pdf") return <FileText size={size} />;
  return <File size={size} />;
}

const AUDIO_THUMBNAIL_BARS = 48;
const audioWaveformCache = new Map<string, Promise<number[] | null>>();
let audioContext: AudioContext | null = null;

function loadAudioWaveform(item: MediaItem): Promise<number[] | null> {
  const cached = audioWaveformCache.get(item.absolutePath);
  if (cached) return cached;
  const pending = previewScheduler.acquire("audio").then(async (release) => {
    try {
      if (item.sizeBytes > MAX_WAVEFORM_DECODE_BYTES) return null;
      const source = await bridge.getMediaUrl(item.absolutePath);
      const separator = source.url.includes("?") ? "&" : "?";
      const response = await fetch(`${source.url}${separator}purpose=waveform`);
      if (!response.ok) return null;
      audioContext ??= new AudioContext();
      const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
      const channels = Array.from(
        { length: buffer.numberOfChannels },
        (_, channel) => buffer.getChannelData(channel),
      );
      return summarizeWaveform(channels, AUDIO_THUMBNAIL_BARS);
    } catch {
      return null;
    } finally {
      release();
    }
  });
  audioWaveformCache.set(item.absolutePath, pending);
  if (audioWaveformCache.size > 128) {
    const oldest = audioWaveformCache.keys().next().value;
    if (oldest) audioWaveformCache.delete(oldest);
  }
  return pending;
}

function AudioTileWaveform({ item }: { item: MediaItem }) {
  const [bars, setBars] = useState<number[] | null>(null);
  useEffect(() => {
    let disposed = false;
    void loadAudioWaveform(item).then((waveform) => {
      if (!disposed) setBars(waveform);
    });
    return () => {
      disposed = true;
    };
  }, [item.absolutePath, item.sizeBytes]);

  if (!bars) return <FileGlyph item={item} />;
  return (
    <svg
      className="asset-audio-waveform"
      viewBox="0 0 96 40"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M0 20H96" />
      {bars.map((peak, index) => {
        const height = Math.max(2, peak * 34);
        return (
          <rect
            key={index}
            x={index * 2 + 0.35}
            y={(40 - height) / 2}
            width="1.3"
            height={height}
            rx="0.65"
          />
        );
      })}
    </svg>
  );
}

function Preview({ item }: { item: MediaItem }) {
  const [url, setUrl] = useState<string | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (item.kind !== "image" && item.kind !== "video") return;
    let disposed = false;
    void previewScheduler.acquire(item.kind).then(async (release) => {
      if (disposed) {
        release();
        return;
      }
      releaseRef.current = release;
      try {
        const mediaSource = await bridge.getMediaUrl(item.absolutePath);
        if (disposed) release();
        else setUrl(mediaSource.url);
      } catch {
        release();
      }
    });
    return () => {
      disposed = true;
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [item.absolutePath, item.kind]);

  const loaded = () => {
    releaseRef.current?.();
    releaseRef.current = null;
  };
  if (url && item.kind === "image") {
    return <img src={url} alt="" loading="lazy" onLoad={loaded} onError={loaded} />;
  }
  if (url && item.kind === "video") {
    return <video src={url} muted preload="metadata" onLoadedMetadata={loaded} onError={loaded} />;
  }
  if (item.kind === "audio") return <AudioTileWaveform item={item} />;
  return <FileGlyph item={item} />;
}

export function AssetTile({
  item,
  annotation,
  selected,
  onSelect,
  onOpen,
  onChange,
  onTrash,
}: AssetTileProps) {
  const status = annotation?.reviewStatus ?? "Unreviewed";
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <motion.button
        type="button"
        draggable
        className={`asset-tile${selected ? " is-selected" : ""}`}
        layoutId={selected ? `asset-${item.id}` : undefined}
        style={{ borderRadius: 14 }}
        transition={{ layout: { type: "spring", stiffness: 420, damping: 36 } }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.99 }}
        title={item.projectRelativePath}
        onDragStartCapture={(event) => {
          event.preventDefault();
          bridge.startFileDrag(item.absolutePath);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelect();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onClick={onSelect}
        onDoubleClick={onOpen}
      >
        <span className="asset-preview">
          <Preview item={item} />
          <span className={`asset-extension type-${item.kind}`}>
            <FileGlyph item={item} size={11} />
            {(item.extension.replace(".", "") || "file").toLocaleUpperCase()}
          </span>
          {item.generation?.costUsd !== null && item.generation?.costUsd !== undefined && (
            <span className="asset-cost">${item.generation.costUsd.toFixed(2)}</span>
          )}
          {annotation?.favorite && <Heart className="favorite-mark" size={13} fill="currentColor" />}
          {status !== "Unreviewed" && (
            <span className={`review-mark review-${status.toLocaleLowerCase().replace(" ", "-")}`}>
              <span className={`status-dot dot-${reviewDots[status]}`} />
              {status}
            </span>
          )}
        </span>
        <span className="asset-copy">
          <strong>{item.name}</strong>
          <small>
            <span>{formatBytes(item.sizeBytes)}</span>
            {annotation && annotation.rating > 0 && (
              <span className="asset-rating"><Star size={10} fill="currentColor" />{annotation.rating}</span>
            )}
          </small>
        </span>
      </motion.button>
      {menu && (
        <AssetContextMenu
          item={item}
          annotation={annotation}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpen={onOpen}
          onChange={onChange}
          onTrash={onTrash}
        />
      )}
    </>
  );
}
