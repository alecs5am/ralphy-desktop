import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { MediaProtocolAccess } from "../electron/media/protocol-access";
import { scanProject } from "../electron/media/project-scanner";
import { makeLibraryFixture, type LibraryFixture } from "./fixtures";

let fixture: LibraryFixture | undefined;

afterEach(async () => {
  if (fixture) await rm(fixture.parentPath, { recursive: true, force: true });
  fixture = undefined;
});

describe("media protocol access", () => {
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
    const token = await access.mint(fixture.rootPath, mediaPath);
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
    await writeFile(mediaPath, "x".repeat(9));
    await expect(access.mint(fixture.rootPath, mediaPath)).rejects.toThrow(/size limit/i);
  });
});
