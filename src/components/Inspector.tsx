import {
  Clipboard,
  ExternalLink,
  File,
  FolderSearch,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import type {
  AnnotationInput,
  MediaAnnotation,
  MediaItem,
  ProjectSummary,
} from "../lib/ipc";
import { bridge } from "../lib/ipc";
import { formatAgentFeedback } from "../lib/agent-feedback";
import { InspectorPreview } from "./InspectorPreview";
import { ReviewControls } from "./ReviewControls";

interface InspectorProps {
  item: MediaItem;
  project: ProjectSummary;
  annotation?: MediaAnnotation;
  previewEnabled?: boolean;
  onChange(annotation: AnnotationInput): void;
  onTrash(): void;
  onOpen?(): void;
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="property-row">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

export function Inspector({
  item,
  project,
  annotation,
  previewEnabled = true,
  onChange,
  onTrash,
  onOpen,
}: InspectorProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyForAgent = async () => {
    try {
      await bridge.copyText(formatAgentFeedback(project, [item], annotation ? { [item.id]: annotation } : {}));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  };

  return (
    <motion.aside
      className="inspector panel-blur"
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0.2, 1] }}
    >
      {previewEnabled && onOpen ? <InspectorPreview item={item} onOpen={onOpen} /> : null}

      <div className="inspector-file">
        <span className="inspector-file-icon"><File size={16} /></span>
        <span>
          <strong>{item.name}</strong>
          <small title={item.projectRelativePath}>{item.projectRelativePath}</small>
        </span>
      </div>

      <button
        className={`agent-copy-button${copyState === "failed" ? " is-error" : ""}`}
        type="button"
        onClick={copyForAgent}
      >
        <Clipboard size={14} />
        {copyState === "copied"
          ? "Copied"
          : copyState === "failed"
            ? "Copy failed"
            : "Copy for Agent"}
      </button>

      <ReviewControls annotation={annotation} onChange={onChange} />

      <section className="inspector-properties">
        <div className="inspector-section-heading">Properties</div>
        <Property label="Ralphy entity">{item.entity.replaceAll("-", " ")}</Property>
        <Property label="Type">{item.kind} · {item.extension || "no extension"}</Property>
        <Property label="Modified">{new Date(item.modifiedAt).toLocaleString()}</Property>
        {item.generation && (
          <>
            <Property label="Provider">{item.generation.provider}</Property>
            <Property label="Model">{item.generation.model}</Property>
            <Property label="Operation">{item.generation.operation}</Property>
            <Property label="Cost">
              {item.generation.costUsd === null ? "unknown" : `$${item.generation.costUsd.toFixed(2)}`}
            </Property>
          </>
        )}
      </section>

      <div className="inspector-actions">
        <button type="button" onClick={() => bridge.showInFinder(item.absolutePath)}>
          <FolderSearch size={13} /> Reveal in Finder
        </button>
        <button type="button" onClick={() => bridge.openExternal(item.absolutePath)}>
          <ExternalLink size={13} /> Open externally
        </button>
        <button className="danger-action" type="button" onClick={onTrash}>
          <Trash2 size={13} /> Move to Bin
        </button>
      </div>
    </motion.aside>
  );
}
