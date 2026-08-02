import type {
  MediaAnnotation,
  MediaEntity,
  MediaGroup,
  MediaItem,
  MediaQueryOptions,
  ReviewStatus,
} from "../../electron/media/types";

export const defaultMediaQuery: MediaQueryOptions = {
  mode: "overview",
  search: "",
  entities: [],
  kinds: [],
  reviewStatuses: [],
  sortBy: "recent",
  sortDirection: "descending",
  groupBy: "none",
  includeIntermediate: false,
};

export function resetProjectQuery(query: MediaQueryOptions): MediaQueryOptions {
  return {
    ...defaultMediaQuery,
    mode: query.mode,
    includeIntermediate: query.includeIntermediate,
  };
}

const modeEntities: Partial<Record<MediaQueryOptions["mode"], MediaEntity[]>> = {
  finals: ["final-render"],
  assets: ["generated-artifact"],
  refs: ["reference"],
  units: ["unit-asset"],
  files: ["lifecycle-document", "production-file", "other-project-file"],
};

const entityLabels: Record<MediaEntity, string> = {
  "generated-artifact": "Generated artifacts",
  "final-render": "Final renders",
  reference: "References",
  "unit-asset": "Unit assets",
  "lifecycle-document": "Lifecycle documents",
  "production-file": "Production files",
  "other-project-file": "Other files",
};

const entityOrder = Object.keys(entityLabels) as MediaEntity[];
const reviewOrder: ReviewStatus[] = [
  "Unreviewed",
  "Shortlist",
  "Approved",
  "Needs Work",
  "Reject",
];

function reviewFor(
  item: MediaItem,
  annotations: Record<string, MediaAnnotation>,
): ReviewStatus {
  return annotations[item.id]?.reviewStatus ?? "Unreviewed";
}

function matchesMode(item: MediaItem, mode: MediaQueryOptions["mode"]): boolean {
  if (mode === "overview") return true;
  const entities = modeEntities[mode];
  return !entities || entities.includes(item.entity);
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: MediaQueryOptions["sortDirection"],
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const result = left - right;
  return direction === "ascending" ? result : -result;
}

export function queryMediaItems(
  items: MediaItem[],
  query: MediaQueryOptions,
  annotations: Record<string, MediaAnnotation>,
): MediaItem[] {
  const search = query.search.trim().toLocaleLowerCase();
  const filtered = items.filter((item) => {
    if (!matchesMode(item, query.mode)) return false;
    if (query.entities.length > 0 && !query.entities.includes(item.entity)) return false;
    if (query.kinds.length > 0 && !query.kinds.includes(item.kind)) return false;
    if (
      query.reviewStatuses.length > 0 &&
      !query.reviewStatuses.includes(reviewFor(item, annotations))
    ) {
      return false;
    }
    if (!search) return true;
    return [
      item.name,
      item.projectRelativePath,
      item.generation?.model ?? "",
      item.generation?.provider ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(search));
  });

  return filtered.sort((left, right) => {
    let result = 0;
    if (query.sortBy === "name") result = left.name.localeCompare(right.name);
    if (query.sortBy === "recent") {
      result = Date.parse(left.modifiedAt) - Date.parse(right.modifiedAt);
    }
    if (query.sortBy === "size") result = left.sizeBytes - right.sizeBytes;
    if (query.sortBy === "review") {
      result =
        reviewOrder.indexOf(reviewFor(left, annotations)) -
        reviewOrder.indexOf(reviewFor(right, annotations));
    }
    if (query.sortBy === "cost") {
      return compareNullableNumber(
        left.generation?.costUsd ?? null,
        right.generation?.costUsd ?? null,
        query.sortDirection,
      );
    }
    return query.sortDirection === "ascending" ? result : -result;
  });
}

export interface MediaGroupResult {
  key: string;
  label: string;
  items: MediaItem[];
}

export function groupMediaItems(
  items: MediaItem[],
  groupBy: MediaGroup,
  annotations: Record<string, MediaAnnotation>,
): MediaGroupResult[] {
  if (groupBy === "none") return [{ key: "all", label: "", items }];
  const keyFor = (item: MediaItem): string => {
    if (groupBy === "entity") return item.entity;
    if (groupBy === "kind") return item.kind;
    return reviewFor(item, annotations);
  };
  const grouped = new Map<string, MediaItem[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = grouped.get(key);
    if (group) group.push(item);
    else grouped.set(key, [item]);
  }
  const keys =
    groupBy === "entity"
      ? entityOrder
      : groupBy === "review"
        ? reviewOrder
        : ["image", "video", "audio", "text", "pdf", "other"];
  return keys.flatMap((key) => {
    const groupItems = grouped.get(key) ?? [];
    if (groupItems.length === 0) return [];
    const label =
      groupBy === "entity"
        ? entityLabels[key as MediaEntity]
        : key === "pdf"
          ? "PDF"
          : `${key.slice(0, 1).toLocaleUpperCase()}${key.slice(1)}`;
    return [{ key, label, items: groupItems }];
  });
}

export function columnCountForWidth(
  width: number,
  targetTileWidth: number,
  gap: number,
): number {
  return Math.max(1, Math.floor((Math.max(0, width) + gap) / (targetTileWidth + gap)));
}

export interface AssetGridGeometry {
  columns: number;
  tileWidth: number;
  tileHeight: number;
  rowHeight: number;
  gap: number;
}

export function assetGridGeometry(
  width: number,
  targetTileWidth: number,
  gap: number,
): AssetGridGeometry {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const safeGap = Math.max(0, Number.isFinite(gap) ? gap : 0);
  const columns = columnCountForWidth(
    safeWidth,
    Math.max(1, Number.isFinite(targetTileWidth) ? targetTileWidth : 1),
    safeGap,
  );
  const tileWidth = Math.max(
    1,
    (safeWidth - safeGap * (columns - 1)) / columns,
  );
  const previewHeight = Math.max(1, tileWidth * 0.625);
  const tileHeight = previewHeight + 54;
  return {
    columns,
    tileWidth,
    tileHeight,
    rowHeight: tileHeight + safeGap,
    gap: safeGap,
  };
}

type PreviewKind = "image" | "video" | "audio";

export function createPreviewScheduler(limits: Record<PreviewKind, number>) {
  const active: Record<PreviewKind, number> = { image: 0, video: 0, audio: 0 };
  const waiting: Record<PreviewKind, Array<(release: () => void) => void>> = {
    image: [],
    video: [],
    audio: [],
  };

  const releaseFor = (kind: PreviewKind): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = waiting[kind].shift();
      if (next) next(releaseFor(kind));
      else active[kind] -= 1;
    };
  };

  return {
    acquire(kind: PreviewKind): Promise<() => void> {
      if (active[kind] < Math.max(1, limits[kind])) {
        active[kind] += 1;
        return Promise.resolve(releaseFor(kind));
      }
      return new Promise((resolve) => waiting[kind].push(resolve));
    },
  };
}

export const previewScheduler = createPreviewScheduler({
  image: 4,
  video: 2,
  audio: 1,
});
