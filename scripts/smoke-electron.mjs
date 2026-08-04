import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { sha256File, validateCoreSource } from "./bundled-core.mjs";

const root = resolve(import.meta.dirname, "..");
const packagedApp = process.env.RALPHY_PACKAGED_APP
  ? resolve(root, process.env.RALPHY_PACKAGED_APP)
  : undefined;

let executable = join(root, "node_modules/.bin/electron");
let appArguments = ["."];
if (packagedApp) {
  const resources = join(packagedApp, "Contents/Resources");
  const core = join(resources, "bin/ralphy");
  await validateCoreSource(core);
  const manifest = JSON.parse(await readFile(join(resources, "ralphy-core.json"), "utf8"));
  if (
    typeof manifest.version !== "string"
    || typeof manifest.sha256 !== "string"
    || await sha256File(core) !== manifest.sha256
    || execFileSync(core, ["--version"], { encoding: "utf8" }).trim()
      !== manifest.version
  ) {
    throw new Error("Packaged Ralphy core does not match its manifest");
  }
  executable = join(packagedApp, "Contents/MacOS/Ralphy Media");
  appArguments = [];
}
const userData = await mkdtemp(join(tmpdir(), "ralphy-media-smoke-"));
const child = spawn(
  executable,
  [...appArguments, "--smoke-test", `--user-data-dir=${userData}`],
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
console.log(packagedApp ? "Packaged Electron smoke passed" : "Electron smoke passed");
