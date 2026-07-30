import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaAnnotation, MediaItem } from "../lib/ipc";
import { columnCountForWidth, type MediaGroupResult } from "../lib/media";
import { AssetTile } from "./AssetTile";

interface VirtualAssetGridProps {
  groups: MediaGroupResult[];
  annotations: Record<string, MediaAnnotation>;
  targetTileWidth: number;
  selectedId: string | null;
  onSelect(item: MediaItem): void;
  onOpen(item: MediaItem): void;
}

type VirtualGridRow =
  | { type: "heading"; key: string; label: string; count: number }
  | { type: "items"; key: string; items: MediaItem[] };

export function VirtualAssetGrid({
  groups,
  annotations,
  targetTileWidth,
  selectedId,
  onSelect,
  onOpen,
}: VirtualAssetGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const gap = 12;
  const columns = columnCountForWidth(width, targetTileWidth, gap);
  const tileWidth = (width - gap * (columns - 1)) / columns;
  const tileHeight = tileWidth * 0.625 + 48;
  const rows = useMemo<VirtualGridRow[]>(() => {
    const next: VirtualGridRow[] = [];
    for (const group of groups) {
      if (group.label) {
        next.push({
          type: "heading",
          key: `heading-${group.key}`,
          label: group.label,
          count: group.items.length,
        });
      }
      for (let index = 0; index < group.items.length; index += columns) {
        next.push({
          type: "items",
          key: `${group.key}-${index}`,
          items: group.items.slice(index, index + columns),
        });
      }
    }
    return next;
  }, [columns, groups]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.type === "heading" ? 34 : tileHeight + gap,
    overscan: 3,
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(1, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => virtualizer.measure(), [tileHeight, virtualizer]);

  if (rows.length === 0) {
    return (
      <div className="asset-grid-empty">
        <strong>No matching files</strong>
        <span>Change the visible filters or switch project mode.</span>
      </div>
    );
  }

  return (
    <div className="asset-grid-scroll" ref={scrollRef}>
      <div
        className="virtual-grid-space"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              className={row.type === "heading" ? "virtual-group-heading" : "virtual-asset-row"}
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns:
                  row.type === "items" ? `repeat(${columns}, minmax(0, 1fr))` : undefined,
              }}
            >
              {row.type === "heading" ? (
                <>
                  <strong>{row.label}</strong>
                  <span>{row.count}</span>
                </>
              ) : row.items.map((item) => (
                <AssetTile
                  key={item.id}
                  item={item}
                  annotation={annotations[item.id]}
                  selected={selectedId === item.id}
                  onSelect={() => onSelect(item)}
                  onOpen={() => onOpen(item)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
