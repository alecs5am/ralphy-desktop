import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const userData = await mkdtemp(join(tmpdir(), "ralphy-media-smoke-"));
const child = spawn(
  join(root, "node_modules/.bin/electron"),
  [".", "--smoke-test", `--user-data-dir=${userData}`],
  {
    cwd: root,
    env: { ...process.env, RALPHY_SMOKE_TEST: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});

const timeout = setTimeout(() => child.kill("SIGTERM"), 15_000);
const exitCode = await new Promise((resolveExit) => child.once("exit", resolveExit));
clearTimeout(timeout);
await rm(userData, { recursive: true, force: true });

if (
  exitCode !== 0
  || !output.includes("RALPHY_SMOKE_READY")
  || !output.includes("RALPHY_TERMINAL_BRIDGE_READY")
) {
  console.error(output);
  process.exit(1);
}
console.log("Electron smoke passed");
