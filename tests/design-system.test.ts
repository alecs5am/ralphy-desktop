import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const styles = ["tokens.css", "app.css", "workbench.css"]
  .map((file) => readFileSync(join(process.cwd(), "src/styles", file), "utf8"))
  .join("\n");
const renderer = [
  "App.tsx",
  "components/ContextSidebar.tsx",
  "components/ProjectControls.tsx",
  "components/Titlebar.tsx",
  "components/VirtualAssetGrid.tsx",
  "components/ui/SelectMenu.tsx",
  "screens/AssetViewer.tsx",
]
  .map((file) => readFileSync(join(process.cwd(), "src", file), "utf8"))
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
    expect(renderer).not.toMatch(/<select(?:\s|>)/);
    expect(renderer).toContain("@radix-ui/react-select");
    expect(renderer).toContain("@radix-ui/react-dialog");
    expect(renderer).toContain("layoutId");
    expect(renderer).toContain('aria-label="Toggle sidebar"');
    expect(renderer).toContain('aria-label="Toggle right panel"');
    expect(renderer).toContain('aria-label="Toggle bottom panel"');
    expect(renderer).toMatch(
      /event\.metaKey[\s\S]*event\.key\.toLocaleLowerCase\(\)\s*===\s*"b"/,
    );
  });

  test("keeps the project grid mounted while the modal viewer is open", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).not.toContain('hidden={viewerItem !== null}');
    expect(app).toContain("<AnimatePresence");
  });
});
