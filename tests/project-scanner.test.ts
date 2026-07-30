import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  ScanCancelledError,
  scanProject,
} from "../electron/media/project-scanner";
import { makeLibraryFixture, type LibraryFixture } from "./fixtures";

let fixture: LibraryFixture | undefined;

afterEach(async () => {
  if (fixture) await rm(fixture.parentPath, { recursive: true, force: true });
  fixture = undefined;
});

describe("selected project scanner", () => {
  test("recursively scans exactly one project and assigns stable Ralphy entities", async () => {
    fixture = await makeLibraryFixture();

    const first = await scanProject({
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "alpha-001",
      generation: 11,
    });
    const second = await scanProject({
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "alpha-001",
      generation: 12,
    });

    const entities = Object.fromEntries(first.items.map((item) => [item.projectRelativePath, item.entity]));
    expect(entities).toMatchObject({
      "render/final.mp4": "final-render",
      "artifacts/images/hero.png": "generated-artifact",
      "artifacts/refs/mood.jpg": "reference",
      "units/hero/cut.mp4": "unit-asset",
      "BRIEF.md": "lifecycle-document",
      "index.html": "production-file",
      "misc.bin": "other-project-file",
    });
    expect(first.items.some((item) => item.absolutePath.startsWith(fixture.betaPath))).toBe(false);
    expect(first.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
    expect(first.generation).toBe(11);
  });

  test("streams a bounded generation ledger and keeps cost totals finite", async () => {
    fixture = await makeLibraryFixture();
    const ledgerPath = join(fixture.alphaPath, "logs", "generations.jsonl");
    await writeFile(
      ledgerPath,
      `${"x".repeat(1024)}\n${await readFile(ledgerPath, "utf8")}`,
    );

    const result = await scanProject(
      {
        rootPath: fixture.rootPath,
        workspaceId: "studio",
        projectId: "alpha-001",
        generation: 1,
      },
      { maxLedgerLineBytes: 512 },
    );

    expect(result.ledger.totalCostUsd).toBe(1);
    expect(Number.isFinite(result.ledger.totalCostUsd)).toBe(true);
    expect(result.ledger.malformedLineCount).toBe(1);
    expect(result.ledger.oversizedLineCount).toBe(1);
    expect(
      result.items.find((item) => item.projectRelativePath === "artifacts/images/hero.png")
        ?.generation,
    ).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-image",
      operation: "image",
      costUsd: 0.25,
    });
  });

  test("bounds total ledger rows and reports truncation", async () => {
    fixture = await makeLibraryFixture();
    const ledgerPath = join(fixture.alphaPath, "logs", "generations.jsonl");
    await writeFile(
      ledgerPath,
      Array.from({ length: 5 }, (_, index) => JSON.stringify({
        timestamp: `2026-07-29T10:0${index}:00.000Z`,
        provider: "test",
        model: "test",
        kind: "image",
        output: { local: `artifacts/images/${index}.png` },
        cost_usd: 1,
      })).join("\n"),
    );

    const result = await scanProject(
      {
        rootPath: fixture.rootPath,
        workspaceId: "studio",
        projectId: "alpha-001",
        generation: 1,
      },
      { maxLedgerEntries: 2, maxLedgerBytes: 1024 },
    );

    expect(result.ledger.entries).toHaveLength(2);
    expect(result.ledger.totalCostUsd).toBe(2);
    expect(result.ledger.truncated).toBe(true);
  });

  test("bounds total ledger bytes", async () => {
    fixture = await makeLibraryFixture();
    const ledgerPath = join(fixture.alphaPath, "logs", "generations.jsonl");
    await writeFile(
      ledgerPath,
      `${JSON.stringify({
        timestamp: "2026-07-29T10:00:00.000Z",
        provider: "test",
        model: "test",
        kind: "image",
        output: { local: "artifacts/images/hero.png" },
        cost_usd: 1,
        padding: "x".repeat(256),
      })}\n`,
    );

    const result = await scanProject(
      {
        rootPath: fixture.rootPath,
        workspaceId: "studio",
        projectId: "alpha-001",
        generation: 1,
      },
      { maxLedgerEntries: 100, maxLedgerBytes: 128 },
    );

    expect(result.ledger.entries).toEqual([]);
    expect(result.ledger.totalCostUsd).toBe(0);
    expect(result.ledger.truncated).toBe(true);
  });

  test("cancels traversal cooperatively", async () => {
    fixture = await makeLibraryFixture();
    const controller = new AbortController();

    const scan = scanProject(
      {
        rootPath: fixture.rootPath,
        workspaceId: "studio",
        projectId: "alpha-001",
        generation: 1,
      },
      {
        signal: controller.signal,
        onProgress(progress) {
          if (progress.filesScanned > 0) controller.abort();
        },
      },
    );

    await expect(scan).rejects.toBeInstanceOf(ScanCancelledError);
  });

  test("does not follow a generation ledger symlink outside the project", async () => {
    fixture = await makeLibraryFixture();
    const outsideLedger = join(fixture.parentPath, "outside-generations.jsonl");
    const ledgerPath = join(fixture.alphaPath, "logs", "generations.jsonl");
    await writeFile(outsideLedger, `${JSON.stringify({
      timestamp: "2026-07-30T00:00:00.000Z",
      provider: "outside",
      model: "outside",
      endpoint: "outside",
      kind: "video",
      input: {},
      status: "ok",
      cost_usd: 999,
    })}\n`);
    await rm(ledgerPath);
    await symlink(outsideLedger, ledgerPath);

    const result = await scanProject({
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "alpha-001",
      generation: 1,
    });

    expect(result.ledger).toMatchObject({ entries: [], totalCostUsd: 0 });
  });

  test("does not follow a symlinked logs directory outside the project", async () => {
    fixture = await makeLibraryFixture();
    const outsideLogs = join(fixture.parentPath, "outside-logs");
    await mkdir(outsideLogs);
    await writeFile(join(outsideLogs, "generations.jsonl"), `${JSON.stringify({
      timestamp: "2026-07-30T00:00:00.000Z",
      provider: "outside",
      model: "outside",
      kind: "video",
      cost_usd: 999,
    })}\n`);
    await rm(join(fixture.alphaPath, "logs"), { recursive: true });
    await symlink(outsideLogs, join(fixture.alphaPath, "logs"));

    const result = await scanProject({
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "alpha-001",
      generation: 1,
    });

    expect(result.ledger).toMatchObject({ entries: [], totalCostUsd: 0 });
  });

  test("prunes real-style intermediate trees by default and supports explicit opt-in", async () => {
    fixture = await makeLibraryFixture();
    const intermediateFiles = [
      "render/work-123/compiled/__hyperframes_video_frames/0001.png",
      "render/work-123/captured-frames/diagnostics/frame.jpg",
      "render/work-123/video-only.mp4",
      "node_modules/pkg/index.js",
      "dist/bundle.js",
      ".cache/thumb.jpg",
    ];
    for (const path of intermediateFiles) {
      const absolutePath = join(fixture.alphaPath, path);
      await mkdir(join(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, path);
    }

    const request = {
      rootPath: fixture.rootPath,
      workspaceId: "studio",
      projectId: "alpha-001",
      generation: 1,
    };
    const relevant = await scanProject(request);
    const complete = await scanProject(request, { includeIntermediate: true });
    const relevantPaths = relevant.items.map((item) => item.projectRelativePath);
    const completePaths = complete.items.map((item) => item.projectRelativePath);

    expect(relevantPaths).toContain("render/final.mp4");
    expect(relevantPaths).not.toEqual(expect.arrayContaining(intermediateFiles));
    expect(completePaths).toEqual(expect.arrayContaining(intermediateFiles));
  });

  test("throttles progress while always reporting the final item count", async () => {
    fixture = await makeLibraryFixture();
    const batchPath = join(fixture.alphaPath, "artifacts", "batch");
    await mkdir(batchPath);
    for (let index = 0; index < 250; index += 1) {
      await writeFile(join(batchPath, `${index}.txt`), String(index));
    }
    const progress: number[] = [];

    const result = await scanProject(
      {
        rootPath: fixture.rootPath,
        workspaceId: "studio",
        projectId: "alpha-001",
        generation: 1,
      },
      { onProgress: (event) => progress.push(event.filesScanned) },
    );

    expect(progress.at(-1)).toBe(result.items.length);
    expect(progress.length).toBeLessThanOrEqual(Math.ceil(result.items.length / 100) + 1);
  });

  test("rejects a project symlink that leaves the selected workspace", async () => {
    fixture = await makeLibraryFixture();
    await expect(
      scanProject({
        rootPath: fixture.rootPath,
        workspaceId: "studio",
        projectId: "../outside",
        generation: 1,
      }),
    ).rejects.toThrow(/project/i);
  });
});
