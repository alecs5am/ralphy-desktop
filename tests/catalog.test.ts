import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildShallowCatalog,
  readBoundedText,
  resolveContainedPath,
  trashContainedItems,
  validateLibraryRoot,
} from "../electron/media/catalog";
import { makeLibraryFixture, type LibraryFixture } from "./fixtures";

let fixture: LibraryFixture | undefined;

afterEach(async () => {
  if (fixture) await rm(fixture.parentPath, { recursive: true, force: true });
  fixture = undefined;
});

describe("shallow library catalog", () => {
  test("opens only direct workspace and project entries without following media", async () => {
    fixture = await makeLibraryFixture();

    const result = await buildShallowCatalog(fixture.rootPath, 7);

    expect(result.generation).toBe(7);
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]).toMatchObject({
      id: "studio",
      name: "Studio",
      description: "Launch workspace",
      projectCount: 2,
      sharedCount: 1,
      unitCount: 1,
      finalCount: 1,
    });
    expect(result.projects.map((project) => project.id)).toEqual([
      "studio/alpha-001",
      "studio/beta-001",
    ]);
    expect(result.projects[0]).toMatchObject({
      name: "Alpha Launch",
      platform: "instagram",
      aspectRatio: "4:5",
      phase: "production",
      finalState: "ready",
      finalCount: 1,
      unitCount: 1,
    });
    expect(result.mediaItemCount).toBe(0);
  });

  test("tolerates malformed and oversized bounded metadata", async () => {
    fixture = await makeLibraryFixture();
    await writeFile(join(fixture.rootPath, "registry.json"), "{bad");
    await writeFile(
      join(fixture.rootPath, "workspaces", "studio", "workspace.json"),
      "x".repeat(1_100_000),
    );

    const result = await buildShallowCatalog(fixture.rootPath);

    expect(result.workspaces[0]).toMatchObject({ id: "studio", name: "studio", projectCount: 2 });
    expect(result.projects.map((project) => project.id)).toEqual([
      "studio/alpha-001",
      "studio/beta-001",
    ]);
  });

  test("does not follow registry metadata symlinks outside the library", async () => {
    fixture = await makeLibraryFixture();
    const outsideRegistry = join(fixture.parentPath, "outside-registry.json");
    await writeFile(outsideRegistry, JSON.stringify({
      projects: {
        "alpha-001": { name: "Leaked Outside Name", workspace: "studio" },
      },
    }));
    await rm(join(fixture.rootPath, "registry.json"));
    await symlink(outsideRegistry, join(fixture.rootPath, "registry.json"));

    const result = await buildShallowCatalog(fixture.rootPath);

    expect(
      result.projects.find((project) => project.projectId === "alpha-001")?.name,
    ).toBe("alpha-001");
  });

  test("uses workspace and project identity for colliding registry ids", async () => {
    fixture = await makeLibraryFixture();
    const agencyProject = join(
      fixture.rootPath,
      "workspaces",
      "agency",
      "projects",
      "alpha-001",
    );
    await mkdir(agencyProject, { recursive: true });
    await writeFile(
      join(fixture.rootPath, "registry.json"),
      JSON.stringify({
        projects: {
          "studio-alpha": {
            id: "alpha-001",
            workspace: "studio",
            name: "Studio Alpha",
          },
          "agency-alpha": {
            id: "alpha-001",
            workspace: "agency",
            name: "Agency Alpha",
          },
        },
      }),
    );

    const result = await buildShallowCatalog(fixture.rootPath);

    expect(
      result.projects.find((project) => project.workspaceId === "studio"
        && project.projectId === "alpha-001"),
    ).toMatchObject({ id: "studio/alpha-001", name: "Studio Alpha" });
    expect(
      result.projects.find((project) => project.workspaceId === "agency"
        && project.projectId === "alpha-001"),
    ).toMatchObject({ id: "agency/alpha-001", name: "Agency Alpha" });
  });
});

describe("library trust boundary", () => {
  test("requires a real .ralphy directory with the current workspace layout", async () => {
    fixture = await makeLibraryFixture();
    await expect(validateLibraryRoot(fixture.parentPath)).rejects.toThrow(/\.ralphy/);

    const fakeRoot = join(fixture.parentPath, "fake", ".ralphy");
    await mkdir(fakeRoot, { recursive: true });
    await expect(validateLibraryRoot(fakeRoot)).rejects.toThrow(/workspaces/);
  });

  test("rejects traversal and symlinks even when the target exists", async () => {
    fixture = await makeLibraryFixture();
    const outside = join(fixture.parentPath, "outside.txt");
    const link = join(fixture.alphaPath, "outside-link.txt");
    await writeFile(outside, "secret");
    await symlink(outside, link);

    await expect(resolveContainedPath(fixture.rootPath, outside)).rejects.toThrow(/outside/);
    await expect(resolveContainedPath(fixture.rootPath, link)).rejects.toThrow(/symbolic link/);
  });

  test("bounded text reads report truncation without reading arbitrary paths", async () => {
    fixture = await makeLibraryFixture();
    const result = await readBoundedText(
      fixture.rootPath,
      join(fixture.alphaPath, "BRIEF.md"),
      5,
    );

    expect(result).toEqual({ text: "# Alp", totalBytes: 8, truncated: true });
    await expect(readBoundedText(fixture.rootPath, join(fixture.parentPath, "outside.txt"))).rejects.toThrow();
  });
});

describe("Trash abstraction", () => {
  test("returns per-item failures and continues trashing valid paths", async () => {
    fixture = await makeLibraryFixture();
    const first = join(fixture.alphaPath, "misc.bin");
    const second = join(fixture.alphaPath, "BRIEF.md");
    const trash = vi.fn(async (path: string) => {
      if (basename(path) === "misc.bin") throw new Error("Trash unavailable");
    });

    const result = await trashContainedItems(fixture.rootPath, [first, second], trash);

    expect(result.trashed.map((path) => basename(path))).toEqual(["BRIEF.md"]);
    expect(result.failed).toEqual([{ path: first, error: "Trash unavailable" }]);
    expect(trash).toHaveBeenCalledTimes(2);
  });
});
