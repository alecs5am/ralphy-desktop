import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { routeLibraryChange } from "../electron/media/watcher";

const root = "/tmp/example/.ralphy";
const selected = { workspaceId: "studio", projectId: "alpha-001" };

describe("watcher path routing", () => {
  test.each([
    ["registry", join(root, "registry.json")],
    ["workspace metadata", join(root, "workspaces", "studio", "workspace.json")],
    ["project structure", join(root, "workspaces", "studio", "projects", "new-001")],
    ["selected production plan", join(root, "workspaces", "studio", "projects", "alpha-001", "production-plan.json")],
  ])("refreshes the shallow catalog for %s changes", (_label, path) => {
    expect(routeLibraryChange(root, path, selected).catalog).toBe(true);
  });

  test("rescans only media inside the selected project", () => {
    const selectedMedia = join(root, "workspaces", "studio", "projects", "alpha-001", "artifacts", "hero.png");
    const inactiveMedia = join(root, "workspaces", "studio", "projects", "beta-001", "artifacts", "hero.png");

    expect(routeLibraryChange(root, selectedMedia, selected)).toEqual({
      catalog: false,
      selectedProject: true,
    });
    expect(routeLibraryChange(root, inactiveMedia, selected)).toEqual({
      catalog: false,
      selectedProject: false,
    });
  });

  test("ignores annotation writes and paths outside the active root", () => {
    expect(
      routeLibraryChange(root, join(root, "media-library", "library.json"), selected),
    ).toEqual({ catalog: false, selectedProject: false });
    expect(routeLibraryChange(root, "/tmp/other/.ralphy/registry.json", selected)).toEqual({
      catalog: false,
      selectedProject: false,
    });
  });
});
