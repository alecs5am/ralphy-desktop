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
import type { MediaAnnotation, MediaItem, ReviewStatus } from "../lib/ipc";
import { bridge } from "../lib/ipc";
import { previewScheduler } from "../lib/media";

interface AssetTileProps {
  item: MediaItem;
  annotation?: MediaAnnotation;
  selected: boolean;
  onSelect(): void;
  onOpen(): void;
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

function FileGlyph({ item }: { item: MediaItem }) {
  if (item.kind === "image") return <Image size={26} />;
  if (item.kind === "video") return <Film size={26} />;
  if (item.kind === "audio") return <Music2 size={26} />;
  if (item.kind === "text") return <FileText size={26} />;
  return <File size={26} />;
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
  return <FileGlyph item={item} />;
}

export function AssetTile({
  item,
  annotation,
  selected,
  onSelect,
  onOpen,
}: AssetTileProps) {
  const status = annotation?.reviewStatus ?? "Unreviewed";
  return (
    <motion.button
      type="button"
      className={`asset-tile${selected ? " is-selected" : ""}`}
      layoutId={`asset-${item.id}`}
      style={{ borderRadius: 14 }}
      transition={{ layout: { type: "spring", stiffness: 420, damping: 36 } }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      title={item.projectRelativePath}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <span className="asset-preview">
        <Preview item={item} />
        <span className="asset-extension">
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
  );
}
