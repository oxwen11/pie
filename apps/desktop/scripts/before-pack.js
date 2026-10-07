import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assertBuiltFffIsland } from "./fff-island.js";

const BUN_VERSION = "bun-v1.4.2";

const VENDOR_DIR = path.join(import.meta.dirname, "..", "vendor");

function bunDownloadName(platform, arch) {
  if (platform === "darwin" && arch === "arm64") return "bun-darwin-aarch64";
  if (platform === "darwin" && arch === "x64") return "bun-darwin-x64";
  if (platform === "linux" && arch === "arm64") return "bun-linux-aarch64";
  if (platform === "linux" && arch === "x64") return "bun-linux-x64-baseline";
  if (platform === "win32" && arch === "arm64") return "bun-windows-aarch64";
  if (platform === "win32" && arch === "x64") return "bun-windows-x64-baseline";
  throw new Error(`Unsupported Bun target: ${platform}-${arch}`);
}

const curl = (...args) =>
  childProcess.execFileSync("curl", ["-fsSL", "--retry", "3", "--retry-delay", "2", ...args], {
    encoding: "utf8",
  });

function downloadBun(platform, arch) {
  const name = bunDownloadName(platform, arch);
  const binary = platform === "win32" ? "bun.exe" : "bun";
  const dest = path.join(VENDOR_DIR, binary);
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  if (fs.statSync(dest, { throwIfNoEntry: false })?.isFile()) return;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pie-bun-"));
  try {
    const releaseUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}`;
    const zipPath = path.join(tmp, `${name}.zip`);

    console.log(`Downloading ${BUN_VERSION} ${name}…`);
    curl("-o", zipPath, `${releaseUrl}/${name}.zip`);

    const expected = curl(`${releaseUrl}/SHASUMS256.txt`)
      .split("\n")
      .find((line) => line.includes(`${name}.zip`))
      ?.split(/\s+/)[0];
    const actual = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
    if (!expected || actual !== expected)
      throw new Error(`Checksum verification failed for ${name}.zip`);

    childProcess.execFileSync("unzip", ["-o", zipPath, "-d", tmp], { stdio: "pipe" });
    fs.copyFileSync(path.join(tmp, name, binary), dest);
    if (platform !== "win32") fs.chmodSync(dest, 0o755);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export default function beforePack(context) {
  assertBuiltFffIsland();
  const arch = ["ia32", "x64", "armv7l", "arm64", "universal"][context.arch];
  downloadBun(context.electronPlatformName, arch);
}
