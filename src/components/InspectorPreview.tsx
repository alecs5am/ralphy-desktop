import { Maximize2 } from "lucide-react";
import type { MediaItem } from "../lib/ipc";
import { AssetContent } from "./media/AssetContent";

export function InspectorPreview({
  item,
  onOpen,
}: {
  item: MediaItem;
  onOpen(): void;
}) {
  return (
    <section className={`inspector-preview preview-${item.kind}`}>
      <header>
        <span>Preview</span>
        <button
          className="icon-button"
          type="button"
          title="Open preview"
          aria-label="Open preview"
          onClick={onOpen}
        >
          <Maximize2 size={14} strokeWidth={1.5} />
        </button>
      </header>
      <div className="inspector-preview-stage">
        <AssetContent item={item} variant="inspector" />
      </div>
    </section>
  );
}
