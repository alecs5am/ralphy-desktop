import {
  Clipboard,
  Eye,
  FolderSearch,
  ListPlus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { AnnotationInput, MediaAnnotation, MediaItem } from "../lib/ipc";
import { bridge } from "../lib/ipc";
import { annotationWithPatch } from "../lib/review";

interface AssetContextMenuProps {
  item: MediaItem;
  annotation?: MediaAnnotation;
  x: number;
  y: number;
  onClose(): void;
  onOpen(): void;
  onChange(annotation: AnnotationInput): void;
  onTrash(): void;
}

export function AssetContextMenu({
  item,
  annotation,
  x,
  y,
  onClose,
  onOpen,
  onChange,
  onTrash,
}: AssetContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnScroll = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    onClose();
    action();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    const direction = event.key === "ArrowDown" ? 1 : -1;
    items[(current + direction + items.length) % items.length]?.focus();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="asset-context-menu"
      role="menu"
      aria-label={`${item.name} actions`}
      style={{
        left: Math.min(x, window.innerWidth - 226),
        top: Math.min(y, window.innerHeight - 244),
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      <button type="button" role="menuitem" onClick={() => run(onOpen)}>
        <Eye size={14} /> Open preview
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run(() => onChange(annotationWithPatch(annotation, { reviewStatus: "Shortlist" })))}
      >
        <ListPlus size={14} /> Shortlist
      </button>
      <div className="asset-context-separator" />
      <button type="button" role="menuitem" onClick={() => run(() => void bridge.showInFinder(item.absolutePath))}>
        <FolderSearch size={14} /> Reveal in Finder
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => void bridge.copyText(item.absolutePath))}>
        <Clipboard size={14} /> Copy path
      </button>
      <div className="asset-context-separator" />
      <button className="danger-action" type="button" role="menuitem" onClick={() => run(onTrash)}>
        <Trash2 size={14} /> Move to Bin
      </button>
    </div>,
    document.body,
  );
}
