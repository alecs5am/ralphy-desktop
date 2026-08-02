import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { AnnotationInput, MediaAnnotation, MediaItem } from "../lib/ipc";
import { assetGridGeometry, type MediaGroupResult } from "../lib/media";
import { AssetTile } from "./AssetTile";

interface VirtualAssetGridProps {
  groups: MediaGroupResult[];
  annotations: Record<string, MediaAnnotation>;
  targetTileWidth: number;
  selectedId: string | null;
  onSelect(item: MediaItem): void;
  onOpen(item: MediaItem): void;
  onChange(item: MediaItem, annotation: AnnotationInput): void;
  onTrash(item: MediaItem): void;
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
  onChange,
  onTrash,
}: VirtualAssetGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const gap = 16;
  const geometry = assetGridGeometry(width, targetTileWidth, gap);
  const { columns } = geometry;
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
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: (index) =>
      rows[index]?.type === "heading" ? 34 : geometry.rowHeight,
    overscan: 3,
  });

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      const style = window.getComputedStyle(element);
      const horizontalPadding =
        Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      setWidth(Math.max(1, element.clientWidth - horizontalPadding));
    };
    measure();
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(1, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => virtualizer.measure(),
    [columns, geometry.rowHeight, virtualizer],
  );

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
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns:
                  row.type === "items" ? `repeat(${columns}, minmax(0, 1fr))` : undefined,
                height:
                  row.type === "items" ? `${geometry.rowHeight}px` : "34px",
                "--asset-tile-height": `${geometry.tileHeight}px`,
                "--asset-row-gap": `${geometry.gap}px`,
              } as CSSProperties}
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
                  onChange={(annotation) => onChange(item, annotation)}
                  onTrash={() => onTrash(item)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
