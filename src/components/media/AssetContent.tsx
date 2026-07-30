import { FileQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import type { MediaItem } from "../../lib/ipc";
import { bridge } from "../../lib/ipc";
import { MarkdownView } from "../MarkdownView";
import { AudioWaveform } from "./AudioWaveform";
import { ImageViewport } from "./ImageViewport";
import { VideoPlayer } from "./VideoPlayer";

interface AssetContentProps {
  item: MediaItem;
  variant?: "viewer" | "inspector";
}

export function AssetContent({
  item,
  variant = "viewer",
}: AssetContentProps) {
  const [source, setSource] = useState<{
    url: string;
    sizeBytes: number;
  } | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const compact = variant === "inspector";

  useEffect(() => {
    let active = true;
    setSource(null);
    setText(null);
    setError(null);
    const load = item.kind === "text"
      ? bridge.readText(item.absolutePath, compact ? 48 * 1024 : undefined).then((result) => {
          if (active) setText(result.text);
        })
      : bridge.getMediaUrl(item.absolutePath).then((mediaSource) => {
          if (active) setSource(mediaSource);
        });
    void load.catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
    };
  }, [compact, item.absolutePath, item.kind]);

  if (error) {
    return <div className="viewer-message"><FileQuestion size={30} /><span>{error}</span></div>;
  }
  if (item.kind === "text" && text !== null) {
    if (item.extension === ".md" || item.extension === ".markdown") {
      return <div className={`viewer-document${compact ? " is-compact" : ""}`}><MarkdownView markdown={text} /></div>;
    }
    return <div className={`viewer-document${compact ? " is-compact" : ""}`}><pre className="plain-text-view">{text}</pre></div>;
  }
  if (!source) return <div className="viewer-message">Loading preview…</div>;
  if (item.kind === "image") return <ImageViewport src={source.url} name={item.name} compact={compact} />;
  if (item.kind === "video") return <VideoPlayer src={source.url} name={item.name} compact={compact} />;
  if (item.kind === "audio") {
    return (
      <AudioWaveform
        src={source.url}
        path={item.absolutePath}
        name={item.name}
        sizeBytes={source.sizeBytes}
        compact={compact}
      />
    );
  }
  if (item.kind === "pdf") return <embed className="viewer-pdf" src={source.url} type="application/pdf" />;
  return <div className="viewer-message"><FileQuestion size={30} /><span>No inline preview for this file.</span></div>;
}
