import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  FolderSearch,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type {
  MediaAnnotation,
  MediaItem,
  ProjectSummary,
} from "../lib/ipc";
import { bridge } from "../lib/ipc";
import { formatAgentFeedback } from "../lib/agent-feedback";
import { AssetContent } from "../components/media/AssetContent";

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
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const surfaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        target?.closest("input, textarea, [contenteditable='true'], [role='slider']")
      ) {
        return;
      }
      if (event.key === "ArrowLeft" && canPrevious) onPrevious();
      if (event.key === "ArrowRight" && canNext) onNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNext, canPrevious, onNext, onPrevious]);

  const copy = async () => {
    try {
      await bridge.copyText(formatAgentFeedback(project, [item], annotation ? { [item.id]: annotation } : {}));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onBack();
      }}
    >
      <Dialog.Portal forceMount>
        <Dialog.Overlay asChild>
          <motion.div
            className="asset-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16 }}
          />
        </Dialog.Overlay>
        <Dialog.Content
          asChild
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            surfaceRef.current?.focus({ preventScroll: true });
          }}
        >
          <motion.section
            ref={surfaceRef}
            tabIndex={-1}
            className="asset-modal-surface"
            layoutId={`asset-${item.id}`}
            style={{ borderRadius: 18 }}
            initial={{ opacity: 0.72 }}
            animate={{ opacity: 1 }}
            transition={{ layout: { type: "spring", stiffness: 380, damping: 34 } }}
          >
            <div className="asset-modal-toolbar">
              <div className="viewer-identity">
                <Dialog.Title asChild>
                  <strong>{item.name}</strong>
                </Dialog.Title>
                <Dialog.Description asChild>
                  <small>{item.projectRelativePath}</small>
                </Dialog.Description>
              </div>
              <div className="viewer-actions">
                <button type="button" disabled={!canPrevious} title="Previous" aria-label="Previous" onClick={onPrevious}><ChevronLeft size={15} /></button>
                <button type="button" disabled={!canNext} title="Next" aria-label="Next" onClick={onNext}><ChevronRight size={15} /></button>
                <button
                  className={copyState === "failed" ? "is-error" : ""}
                  type="button"
                  onClick={copy}
                >
                  <Clipboard size={13} />
                  {copyState === "copied"
                    ? "Copied"
                    : copyState === "failed"
                      ? "Copy failed"
                      : "Copy for Agent"}
                </button>
                <button type="button" title="Reveal in Finder" aria-label="Reveal in Finder" onClick={() => bridge.showInFinder(item.absolutePath)}><FolderSearch size={14} /></button>
                <button type="button" title="Open externally" aria-label="Open externally" onClick={() => bridge.openExternal(item.absolutePath)}><ExternalLink size={14} /></button>
                <Dialog.Close asChild>
                  <button type="button" title="Close preview" aria-label="Close preview">
                    <X size={15} />
                  </button>
                </Dialog.Close>
              </div>
            </div>
            <div className={`asset-modal-stage asset-modal-kind-${item.kind}`}>
              <motion.div
                className="asset-modal-content"
                key={item.id}
                initial={{ opacity: 0, scale: 0.995 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.12 }}
              >
                <AssetContent item={item} />
              </motion.div>
            </div>
          </motion.section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
