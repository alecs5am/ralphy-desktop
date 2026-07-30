import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronApp = join(root, "node_modules/electron/dist/Electron.app");
const output = join(root, "release/Ralphy Media.app");
const contents = join(output, "Contents");
const resources = join(contents, "Resources");
const application = join(resources, "app");

await rm(output, { recursive: true, force: true });
await mkdir(dirname(output), { recursive: true });
execFileSync("ditto", [electronApp, output]);
await rename(
  join(contents, "MacOS/Electron"),
  join(contents, "MacOS/Ralphy Media"),
);

await mkdir(application, { recursive: true });
await cp(join(root, "dist"), join(application, "dist"), { recursive: true });
await cp(join(root, "dist-electron"), join(application, "dist-electron"), {
  recursive: true,
});
await writeFile(
  join(application, "package.json"),
  JSON.stringify({
    name: "ralphy-media",
    version: "0.1.0",
    private: true,
    main: "dist-electron/main.cjs",
  }, null, 2),
);
await cp(join(root, "build/RalphyMedia.icns"), join(resources, "RalphyMedia.icns"));

const plist = join(contents, "Info.plist");
const replace = (key, type, value) => {
  execFileSync("plutil", ["-replace", key, `-${type}`, value, plist]);
};
replace("CFBundleDisplayName", "string", "Ralphy Media");
replace("CFBundleName", "string", "Ralphy Media");
replace("CFBundleExecutable", "string", "Ralphy Media");
replace("CFBundleIdentifier", "string", "dev.ralphy.media");
replace("CFBundleShortVersionString", "string", "0.1.0");
replace("CFBundleVersion", "string", "1");
replace("CFBundleIconFile", "string", "RalphyMedia.icns");
execFileSync("codesign", ["--force", "--deep", "--sign", "-", output], {
  stdio: "inherit",
});
console.log(output);
