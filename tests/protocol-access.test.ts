import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MediaProtocolAccess,
  resolveMediaByteRange,
  trashAuthorizedItems,
} from "../electron/media/protocol-access";
import { scanProject } from "../electron/media/project-scanner";
import { makeLibraryFixture, type LibraryFixture } from "./fixtures";
import { MediaSessionState } from "../electron/media/session";

let fixture: LibraryFixture | undefined;

afterEach(async () => {
  if (fixture) await rm(fixture.parentPath, { recursive: true, force: true });
  fixture = undefined;
});

describe("media protocol access", () => {
  test("resolves bounded, open-ended, and suffix byte ranges", () => {
    expect(resolveMediaByteRange(null, 4096)).toBeNull();
    expect(resolveMediaByteRange("bytes=1024-2047", 4096)).toEqual({
      start: 1024,
      end: 2047,
    });
    expect(resolveMediaByteRange("bytes=1024-", 4096)).toEqual({
      start: 1024,
      end: 4095,
    });
    expect(resolveMediaByteRange("bytes=-500", 4096)).toEqual({
      start: 3596,
      end: 4095,
    });
    expect(resolveMediaByteRange("bytes=4000-9999", 4096)).toEqual({
      start: 4000,
      end: 4095,
    });
  });

  test("rejects malformed and unsatisfiable byte ranges", () => {
    expect(resolveMediaByteRange("bytes=4096-", 4096)).toBeNull();
    expect(resolveMediaByteRange("bytes=10-9", 4096)).toBeNull();
    expect(resolveMediaByteRange("bytes=0-1,4-5", 4096)).toBeNull();
    expect(resolveMediaByteRange("items=0-1", 4096)).toBeNull();
    expect(resolveMediaByteRange("bytes=-0", 4096)).toBeNull();
  });

  test("mints and resolves only current selected-project media", async () => {
    fixture = await makeLibraryFixture();
    const access = new MediaProtocolAccess({ maxAssetBytes: 1024 });
    const alpha = await scanProject({
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "alpha-001",
      generation: 1,
    });
    access.replace(alpha);

    const mediaPath = join(fixture.alphaPath, "artifacts", "images", "hero.png");
    const { token, sizeBytes } = await access.mint(fixture.rootPath, mediaPath);
    expect(sizeBytes).toBeGreaterThan(0);
    expect(await access.resolve(fixture.rootPath, token)).toBe(
      alpha.items.find((item) => item.projectRelativePath === "artifacts/images/hero.png")
        ?.absolutePath,
    );
    await expect(
      access.mint(fixture.rootPath, join(fixture.rootPath, "registry.json")),
    ).rejects.toThrow(/selected project media/i);
    await expect(
      access.mint(fixture.rootPath, join(fixture.betaPath, "artifacts", "videos", "beta.mp4")),
    ).rejects.toThrow(/selected project media/i);

    const beta = await scanProject({
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "beta-001",
      generation: 2,
    });
    access.replace(beta);
    await expect(access.resolve(fixture.rootPath, token)).rejects.toThrow(/token/i);
  });

  test("rejects non-previewable and oversized files even when scanned", async () => {
    fixture = await makeLibraryFixture();
    const access = new MediaProtocolAccess({ maxAssetBytes: 8 });
    const result = await scanProject({
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "alpha-001",
      generation: 1,
    });
    access.replace(result);

    await expect(
      access.mint(fixture.rootPath, join(fixture.alphaPath, "BRIEF.md")),
    ).rejects.toThrow(/media kind/i);
    const mediaPath = join(fixture.alphaPath, "artifacts", "images", "hero.png");
    await writeFile(mediaPath, "x".repeat(7));
    const minted = await access.mint(fixture.rootPath, mediaPath);
    expect(minted.sizeBytes).toBe(7);
    await writeFile(mediaPath, "x".repeat(9));
    await expect(access.mint(fixture.rootPath, mediaPath)).rejects.toThrow(/size limit/i);
  });

  test("authorizes file actions only for regular files in the current scan", async () => {
    fixture = await makeLibraryFixture();
    const access = new MediaProtocolAccess();
    const result = await scanProject({
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "alpha-001",
      generation: 1,
    });
    access.replace(result);
    const brief = join(fixture.alphaPath, "BRIEF.md");

    await expect(access.resolveFile(fixture.rootPath, brief, ["text"])).resolves.toMatch(/BRIEF\.md$/);
    await expect(
      access.resolveFile(fixture.rootPath, join(fixture.rootPath, "registry.json")),
    ).rejects.toThrow(/selected project/i);
    await expect(
      access.resolveFile(fixture.rootPath, join(fixture.rootPath, "media-library", "library.json")),
    ).rejects.toThrow(/selected project/i);
    await expect(
      access.resolveFile(fixture.rootPath, join(fixture.rootPath, "workspaces", "studio")),
    ).rejects.toThrow(/selected project/i);
    await expect(
      access.resolveFile(fixture.rootPath, join(fixture.betaPath, "artifacts", "videos", "beta.mp4")),
    ).rejects.toThrow(/selected project/i);
    await expect(access.resolveFile(fixture.rootPath, "")).rejects.toThrow(/path/i);
    await expect(access.resolveFile(fixture.rootPath, "x".repeat(4097))).rejects.toThrow(/path/i);
    await expect(
      access.resolveFile(fixture.rootPath, join(fixture.alphaPath, "misc.bin"), ["text"]),
    ).rejects.toThrow(/file type/i);
  });

  test("reports partial Trash failures without invoking Trash for unauthorized paths", async () => {
    fixture = await makeLibraryFixture();
    const access = new MediaProtocolAccess();
    access.replace(await scanProject({
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "alpha-001",
      generation: 1,
    }));
    const trashed: string[] = [];
    const registry = join(fixture.rootPath, "registry.json");
    const inactive = join(fixture.betaPath, "artifacts", "videos", "beta.mp4");
    const selected = join(fixture.alphaPath, "misc.bin");

    const result = await trashAuthorizedItems(
      fixture.rootPath,
      [registry, inactive, selected],
      access,
      async (path) => {
        trashed.push(path);
      },
    );

    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatch(/misc\.bin$/);
    expect(result.trashed).toEqual(trashed);
    expect(result.failed.map((failure) => failure.path)).toEqual([registry, inactive]);
  });

  test("rejects Trash when a root switch wins delayed file authorization", async () => {
    const state = new MediaSessionState();
    const firstRoot = "/tmp/first/.ralphy";
    const secondRoot = "/tmp/second/.ralphy";
    state.activateRoot(firstRoot);
    const operation = state.captureActive();
    let resolvePath!: (path: string) => void;
    const resolvedPath = new Promise<string>((resolve) => {
      resolvePath = resolve;
    });
    const access = {
      resolveFile: () => resolvedPath,
    } as unknown as MediaProtocolAccess;
    const trashItem = vi.fn(async () => undefined);
    const pending = trashAuthorizedItems(
      firstRoot,
      ["/tmp/first/.ralphy/file.mp4"],
      access,
      trashItem,
      () => state.assertActive(operation),
    );

    state.activateRoot(secondRoot);
    resolvePath("/tmp/first/.ralphy/file.mp4");

    await expect(pending).rejects.toThrow(/stale media session/i);
    expect(trashItem).not.toHaveBeenCalled();
  });
});
