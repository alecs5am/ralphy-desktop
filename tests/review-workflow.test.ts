import { describe, expect, test } from "vitest";
import type {
  MediaAnnotation,
  MediaItem,
  ProjectSummary,
} from "../electron/media/types";
import {
  AGENT_FEEDBACK_LIMIT_CHARS,
  formatAgentFeedback,
} from "../src/lib/agent-feedback";
import {
  adjacentMediaItem,
  annotationWithPatch,
  normalizeTags,
} from "../src/lib/review";

const project: ProjectSummary = {
  id: "studio/launch",
  workspaceId: "studio",
  projectId: "launch",
  name: "Launch",
  brief: "A concise creator spot.",
  absolutePath: "/tmp/.ralphy/workspaces/studio/projects/launch",
  status: "assets",
  phase: "production",
  finalState: "review",
  platform: "tiktok",
  aspectRatio: "9:16",
  spendUsd: 1.2,
  finalCount: 0,
  sharedCount: 0,
  unitCount: 0,
  recentActivity: "2026-07-30T10:00:00.000Z",
};

function item(id: string): MediaItem {
  return {
    id,
    workspaceId: "studio",
    projectId: "launch",
    name: `${id}.mp4`,
    absolutePath: `${project.absolutePath}/artifacts/${id}.mp4`,
    projectRelativePath: `artifacts/${id}.mp4`,
    entity: "generated-artifact",
    kind: "video",
    extension: ".mp4",
    sizeBytes: 100,
    modifiedAt: "2026-07-30T10:00:00.000Z",
    generation: {
      provider: "openrouter",
      model: "kling-v3",
      operation: "video",
      timestamp: "2026-07-30T10:00:00.000Z",
      costUsd: 1.2,
      slot: "hook",
    },
  };
}

const reviewed: MediaAnnotation = {
  reviewStatus: "Needs Work",
  favorite: true,
  rating: 3,
  tags: ["hook", "camera"],
  notes: "Keep the framing, replace the motion.",
  updatedAt: "2026-07-30T10:00:00.000Z",
};

describe("review workflow", () => {
  test("normalizes review edits before persistence", () => {
    expect(normalizeTags([" Hook ", "hook", "", "CAMERA"])).toEqual(["Hook", "CAMERA"]);
    expect(annotationWithPatch(reviewed, { rating: 12, tags: [" keep ", "keep"] }))
      .toMatchObject({ rating: 5, tags: ["keep"], reviewStatus: "Needs Work" });
  });

  test("formats concise absolute-path feedback for an agent", () => {
    const media = item("scene-01");
    const text = formatAgentFeedback(project, [media], { [media.id]: reviewed });

    expect(text).toContain("## Ralphy review: Launch");
    expect(text).toContain(media.absolutePath);
    expect(text).toContain("Needs Work");
    expect(text).toContain("Keep the framing, replace the motion.");
    expect(text).toContain("kling-v3");
    expect(text).toContain("$1.20");
  });

  test("bounds large review batches below the clipboard IPC limit", () => {
    const media = item("scene-oversized");
    const text = formatAgentFeedback(project, [media], {
      [media.id]: {
        ...reviewed,
        notes: "x".repeat(AGENT_FEEDBACK_LIMIT_CHARS + 100),
      },
    });

    expect(text.length).toBeLessThanOrEqual(AGENT_FEEDBACK_LIMIT_CHARS);
    expect(text).toContain("Feedback truncated to clipboard limit");
  });

  test("navigates adjacent visible items without wrapping", () => {
    const items = [item("a"), item("b"), item("c")];
    expect(adjacentMediaItem(items, "b", 1)?.id).toBe("c");
    expect(adjacentMediaItem(items, "b", -1)?.id).toBe("a");
    expect(adjacentMediaItem(items, "c", 1)).toBeNull();
  });
});
