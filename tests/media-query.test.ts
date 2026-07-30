import { describe, expect, test } from "vitest";
import type {
  MediaAnnotation,
  MediaItem,
  MediaQueryOptions,
} from "../electron/media/types";
import {
  assetGridGeometry,
  columnCountForWidth,
  createPreviewScheduler,
  defaultMediaQuery,
  groupMediaItems,
  queryMediaItems,
  resetProjectQuery,
} from "../src/lib/media";

function item(
  id: string,
  overrides: Partial<MediaItem> = {},
): MediaItem {
  return {
    id,
    workspaceId: "studio",
    projectId: "launch",
    name: `${id}.png`,
    absolutePath: `/tmp/${id}.png`,
    projectRelativePath: `artifacts/${id}.png`,
    entity: "generated-artifact",
    kind: "image",
    extension: ".png",
    sizeBytes: 100,
    modifiedAt: "2026-07-30T10:00:00.000Z",
    generation: null,
    ...overrides,
  };
}

function annotation(
  reviewStatus: MediaAnnotation["reviewStatus"],
): MediaAnnotation {
  return {
    reviewStatus,
    favorite: false,
    rating: 0,
    tags: [],
    notes: "",
    updatedAt: "2026-07-30T10:00:00.000Z",
  };
}

const items = [
  item("final", {
    entity: "final-render",
    kind: "video",
    extension: ".mp4",
    generation: {
      provider: "ralphy",
      model: "ffmpeg",
      operation: "render",
      timestamp: "2026-07-30T10:00:00.000Z",
      costUsd: 0.1,
      slot: "final",
    },
  }),
  item("expensive", {
    generation: {
      provider: "openrouter",
      model: "kling",
      operation: "video",
      timestamp: "2026-07-30T09:00:00.000Z",
      costUsd: 1.2,
      slot: "hook",
    },
  }),
  item("brief", {
    name: "BRIEF.md",
    projectRelativePath: "BRIEF.md",
    entity: "lifecycle-document",
    kind: "text",
    extension: ".md",
    modifiedAt: "2026-07-29T10:00:00.000Z",
  }),
];

describe("media query", () => {
  test("maps project modes to Ralphy entities instead of a global asset dump", () => {
    expect(queryMediaItems(items, { ...defaultMediaQuery, mode: "finals" }, {}).map((value) => value.id))
      .toEqual(["final"]);
    expect(queryMediaItems(items, { ...defaultMediaQuery, mode: "files" }, {}).map((value) => value.id))
      .toEqual(["brief"]);
  });

  test("combines search, kind, and review filters", () => {
    const query: MediaQueryOptions = {
      ...defaultMediaQuery,
      search: "expensive",
      kinds: ["image"],
      reviewStatuses: ["Shortlist"],
    };
    const annotations = {
      expensive: annotation("Shortlist"),
      final: annotation("Reject"),
    };
    expect(queryMediaItems(items, query, annotations).map((value) => value.id))
      .toEqual(["expensive"]);
  });

  test("sorts attributed cost with unknown costs last", () => {
    const query: MediaQueryOptions = {
      ...defaultMediaQuery,
      sortBy: "cost",
      sortDirection: "descending",
    };
    expect(queryMediaItems(items, query, {}).map((value) => value.id))
      .toEqual(["expensive", "final", "brief"]);
  });

  test("groups by entity using stable display labels", () => {
    const groups = groupMediaItems(items, "entity", {});
    expect(groups.map((group) => group.label)).toEqual([
      "Generated artifacts",
      "Final renders",
      "Lifecycle documents",
    ]);
  });

  test("resets visible filters without changing the project mode or scan scope", () => {
    const query: MediaQueryOptions = {
      ...defaultMediaQuery,
      mode: "assets",
      search: "hero",
      kinds: ["image"],
      reviewStatuses: ["Shortlist"],
      sortBy: "cost",
      groupBy: "review",
      includeIntermediate: true,
    };

    expect(resetProjectQuery(query)).toEqual({
      ...defaultMediaQuery,
      mode: "assets",
      includeIntermediate: true,
    });
  });
});

describe("grid geometry", () => {
  test("keeps tile widths stable as the viewport changes", () => {
    expect(columnCountForWidth(800, 220, 12)).toBe(3);
    expect(columnCountForWidth(1110, 220, 12)).toBe(4);
    expect(columnCountForWidth(180, 220, 12)).toBe(1);
  });

  test("reserves one explicit non-overlapping height for every virtual asset row", () => {
    const geometry = assetGridGeometry(1110, 220, 16);

    expect(geometry.columns).toBe(4);
    expect(geometry.tileWidth).toBeCloseTo(265.5);
    expect(geometry.tileHeight).toBeCloseTo(219.94, 1);
    expect(geometry.rowHeight).toBeCloseTo(235.94, 1);
    expect(geometry.rowHeight).toBeGreaterThanOrEqual(
      geometry.tileHeight + geometry.gap,
    );
  });

  test("keeps row geometry finite at a collapsed container width", () => {
    expect(assetGridGeometry(0, 220, 16)).toEqual({
      columns: 1,
      tileWidth: 1,
      tileHeight: 55,
      rowHeight: 71,
      gap: 16,
    });
  });

  test("bounds concurrent preview decodes by media kind", async () => {
    const scheduler = createPreviewScheduler({ image: 2, video: 1 });
    const releaseFirst = await scheduler.acquire("image");
    const releaseSecond = await scheduler.acquire("image");
    let thirdStarted = false;
    const third = scheduler.acquire("image").then((release) => {
      thirdStarted = true;
      return release;
    });

    await Promise.resolve();
    expect(thirdStarted).toBe(false);
    releaseFirst();
    const releaseThird = await third;
    expect(thirdStarted).toBe(true);

    releaseSecond();
    releaseThird();
  });
});
