import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const styles = ["tokens.css", "app.css", "workbench.css"]
  .map((file) => readFileSync(join(process.cwd(), "src/styles", file), "utf8"))
  .join("\n");
const renderer = readdirSync(join(process.cwd(), "src"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
  .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
  .join("\n");

describe("design system contract", () => {
  test("uses only the supplied type scale and regular weight", () => {
    expect(styles).not.toMatch(/font-size:\s*(?:9|10)px/);
    expect(styles).not.toContain("font-weight: 500");
    expect(styles).not.toContain("text-transform: uppercase");
    expect(styles).not.toMatch(/letter-spacing:\s*-/);
  });

  test("names the responsive controls container and preserves round pills", () => {
    expect(styles).toContain("container-name: project-controls");
    expect(styles).toContain("@container project-controls");
    expect(styles).toMatch(/\.filter-chip,[\s\S]*corner-shape:\s*round/);
  });

  test("uses the approved neutral surfaces and larger smooth radii", () => {
    expect(styles).toMatch(/--canvas:\s*#181818/);
    expect(styles).toMatch(/--raised:\s*#2d2d2d/);
    expect(styles).toMatch(/--radius-md:\s*10px/);
    expect(styles).toMatch(/\.main-header\s*\{[^}]*border-bottom:\s*0/s);
    expect(styles).toMatch(/\.asset-modal-surface,[\s\S]*corner-shape:\s*squircle/);
  });

  test("uses headless selectors, panel shortcuts, and a shared-layout dialog", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(renderer).not.toMatch(/<select(?:\s|>)/);
    expect(renderer).toContain("@radix-ui/react-select");
    expect(renderer).toContain("@radix-ui/react-dialog");
    expect(renderer).toContain('role="listbox"');
    expect(renderer).toContain('role="slider"');
    expect(renderer).toContain("layoutId");
    expect(renderer).toContain('aria-label="Toggle sidebar"');
    expect(renderer).toContain('aria-label="Toggle right panel"');
    expect(renderer).toContain('aria-label="Toggle bottom panel"');
    expect(app).toContain("if (event.repeat) return");
    expect(app).toContain('command && key === "b"');
    expect(app).toContain('command && key === "j"');
    expect(app).toContain('commandOption && key === "b"');
  });

  test("keeps the project grid mounted while the modal viewer is open", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const viewer = readFileSync(
      join(process.cwd(), "src/screens/AssetViewer.tsx"),
      "utf8",
    );
    expect(app).not.toContain('hidden={viewerItem !== null}');
    expect(app).toContain("<AnimatePresence");
    expect(app).not.toMatch(/<AnimatePresence[^>]*>\s*\{viewerItem/);
    expect(app).toContain('" viewer-open"');
    expect(viewer).not.toContain('mode="wait"');
    expect(viewer).not.toContain("viewer-${item.kind}");
    expect(viewer).toContain("asset-modal-kind-${item.kind}");
    expect(viewer).toContain("surfaceRef.current?.focus");
    expect(viewer).toContain("tabIndex={-1}");
    expect(styles).toContain(".workbench.viewer-open .asset-grid-scroll");
    expect(styles).toMatch(/\.viewer-document\s*\{[^}]*overscroll-behavior:\s*contain/s);
  });

  test("uses custom seekable media controls and an interactive image viewport", () => {
    expect(renderer).not.toMatch(/<video[^>]*\scontrols(?:\s|=|>)/);
    expect(renderer).not.toMatch(/<audio[^>]*\scontrols(?:\s|=|>)/);
    expect(renderer).not.toMatch(/type=["']range["']/);
    expect(renderer).toContain("WaveSurfer.create");
    expect(renderer).toContain("shouldDecodeWaveform");
    expect(renderer).toContain("purpose=waveform");
    expect(renderer).toContain("bridge.getMediaUrl(path)");
    expect(renderer).toContain('ariaLabel="Audio position"');
    expect(renderer).toContain('aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}');
    expect(renderer).toContain('playing ? "Pause video" : "Play video"');
    expect(renderer).toContain("This video cannot be played.");
    expect(renderer).toContain('aria-label="Zoom in"');
    expect(renderer).toContain("onWheel");
    expect(renderer).toContain("event.button !== 1");
  });

  test("provides searchable workspace navigation and resizable utility panels", () => {
    expect(renderer).toContain('aria-label="Search workspaces"');
    expect(renderer).toContain('aria-activedescendant');
    expect(renderer).toContain("closeAndRestoreFocus");
    expect(renderer).toContain('ariaLabel="Resize sidebar"');
    expect(renderer).toContain('ariaLabel="Resize right panel"');
    expect(renderer).toContain('ariaLabel="Resize bottom panel"');
    expect(renderer).toContain("<InspectorPreview");
    expect(renderer).toContain("previewEnabled={!viewerItem}");
    expect(renderer).toContain("selectedAssetItems");
    expect(renderer).toContain("onLostPointerCapture");
    expect(renderer).toContain("breadcrumb-button");
  });

  test("keeps library switching in the profile and panel toggles in requested order", () => {
    const titlebar = readFileSync(
      join(process.cwd(), "src/components/Titlebar.tsx"),
      "utf8",
    );
    expect(titlebar).not.toContain("MoreHorizontal");
    expect(titlebar).not.toContain("Change library");
    expect(titlebar.indexOf('aria-label="Toggle bottom panel"')).toBeLessThan(
      titlebar.indexOf('aria-label="Toggle right panel"'),
    );
    const main = readFileSync(join(process.cwd(), "electron/main.ts"), "utf8");
    expect(main).toContain("trafficLightPosition");
  });
});
