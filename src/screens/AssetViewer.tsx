import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  FileQuestion,
  FolderSearch,
  Music2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  MediaAnnotation,
  MediaItem,
  ProjectSummary,
} from "../lib/ipc";
import { bridge } from "../lib/ipc";
import { formatAgentFeedback } from "../lib/agent-feedback";
import { MarkdownView } from "../components/MarkdownView";

interface AssetViewerProps {
  item: MediaItem;
  project: ProjectSummary;
  annotation?: MediaAnnotation;
  canPrevious: boolean;
  canNext: boolean;
  onBack(): void;
  onPrevious(): void;
  onNext(): void;
}

function AssetContent({ item }: { item: MediaItem }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setText(null);
    setError(null);
    const load = item.kind === "text"
      ? bridge.readText(item.absolutePath).then((result) => {
          if (active) setText(result.text);
        })
      : bridge.getMediaUrl(item.absolutePath).then((mediaUrl) => {
          if (active) setUrl(mediaUrl);
        });
    void load.catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
    };
  }, [item.absolutePath, item.kind]);

  if (error) return <div className="viewer-message"><FileQuestion size={30} /><span>{error}</span></div>;
  if (item.kind === "text" && text !== null) {
    if (item.extension === ".md" || item.extension === ".markdown") {
      return <div className="viewer-document"><MarkdownView markdown={text} /></div>;
    }
    return <div className="viewer-document"><pre className="plain-text-view">{text}</pre></div>;
  }
  if (!url) return <div className="viewer-message">Loading preview…</div>;
  if (item.kind === "image") return <img className="viewer-image" src={url} alt={item.name} />;
  if (item.kind === "video") return <video className="viewer-video" src={url} controls autoPlay={false} preload="metadata" />;
  if (item.kind === "audio") {
    return (
      <div className="viewer-audio">
        <Music2 size={38} />
        <strong>{item.name}</strong>
        <audio src={url} controls preload="metadata" />
      </div>
    );
  }
  if (item.kind === "pdf") return <embed className="viewer-pdf" src={url} type="application/pdf" />;
  return <div className="viewer-message"><FileQuestion size={30} /><span>No inline preview for this file.</span></div>;
}

export function AssetViewer({
  item,
  project,
  annotation,
  canPrevious,
  canNext,
  onBack,
  onPrevious,
  onNext,
}: AssetViewerProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
      if (event.key === "ArrowLeft" && canPrevious) onPrevious();
      if (event.key === "ArrowRight" && canNext) onNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNext, canPrevious, onBack, onNext, onPrevious]);

  const copy = async () => {
    await bridge.copyText(formatAgentFeedback(project, [item], annotation ? { [item.id]: annotation } : {}));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <main className="main-region asset-viewer">
      <div className="viewer-toolbar">
        <button type="button" className="viewer-back" onClick={onBack}>
          <ArrowLeft size={14} /> Back to project
        </button>
        <div className="viewer-identity">
          <strong>{item.name}</strong>
          <small>{item.projectRelativePath}</small>
        </div>
        <div className="viewer-actions">
          <button type="button" disabled={!canPrevious} title="Previous" aria-label="Previous" onClick={onPrevious}><ChevronLeft size={15} /></button>
          <button type="button" disabled={!canNext} title="Next" aria-label="Next" onClick={onNext}><ChevronRight size={15} /></button>
          <button type="button" onClick={copy}><Clipboard size={13} />{copied ? "Copied" : "Copy for Agent"}</button>
          <button type="button" title="Reveal in Finder" aria-label="Reveal in Finder" onClick={() => bridge.showInFinder(item.absolutePath)}><FolderSearch size={14} /></button>
          <button type="button" title="Open externally" aria-label="Open externally" onClick={() => bridge.openExternal(item.absolutePath)}><ExternalLink size={14} /></button>
        </div>
      </div>
      <div className={`viewer-stage viewer-${item.kind}`}>
        <AssetContent item={item} />
      </div>
    </main>
  );
}
