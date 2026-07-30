import { describe, expect, test } from "vitest";

async function imageViewportModule() {
  const path = "../src/lib/image-viewport";
  return import(/* @vite-ignore */ path).catch(() => null);
}

describe("image viewport geometry", () => {
  test("keeps the image point under the cursor fixed while zooming", async () => {
    const viewport = await imageViewportModule();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    expect(
      viewport.zoomAroundPoint(
        { scale: 1, x: 0, y: 0 },
        { x: 100, y: -50 },
        2,
      ),
    ).toEqual({ scale: 2, x: -100, y: 50 });
  });

  test("prevents panning an image beyond its visible edges", async () => {
    const viewport = await imageViewportModule();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    expect(
      viewport.clampImageTransform(
        { scale: 1, x: 80, y: -80 },
        { width: 400, height: 300 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ scale: 1, x: 0, y: 0 });
    expect(
      viewport.clampImageTransform(
        { scale: 3, x: 500, y: -500 },
        { width: 400, height: 300 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ scale: 3, x: 200, y: -150 });
  });

  test("maps wheel movement to a bounded smooth zoom", async () => {
    const viewport = await imageViewportModule();
    expect(viewport).not.toBeNull();
    if (!viewport) return;

    expect(viewport.scaleFromWheel(1, -10_000)).toBe(8);
    expect(viewport.scaleFromWheel(8, 10_000)).toBe(1);
    expect(viewport.scaleFromWheel(2, 0)).toBe(2);
  });
});
