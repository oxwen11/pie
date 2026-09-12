const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Pin the current latest Bun. Bump when shipping a newer runtime. */
const BUN_VERSION = "bun-v1.4.2";

const VENDOR_DIR = path.join(__dirname, "..", "vendor");

function bunDownloadName(platform, arch) {
  if (platform === "darwin" && arch === "arm64") return "bun-darwin-aarch64";
  if (platform === "darwin" && arch === "x64") return "bun-darwin-x64";
  if (platform === "linux" && arch === "arm64") return "bun-linux-aarch64";
  if (platform === "linux" && arch === "x64") return "bun-linux-x64-baseline";
  if (platform === "win32" && arch === "arm64") return "bun-windows-aarch64";
  if (platform === "win32" && arch === "x64") return "bun-windows-x64-baseline";
  throw new Error(`Unsupported Bun target: ${platform}-${arch}`);
}

function bunBinaryName(platform) {
  return platform === "win32" ? "bun.exe" : "bun";
}

function curl(...args) {
  return execFileSync("curl", ["-fsSL", "--retry", "3", "--retry-delay", "2", ...args], {
    encoding: "utf8",
  });
}

function downloadBun(platform, arch) {
  const name = bunDownloadName(platform, arch);
  const binary = bunBinaryName(platform);
  const dest = path.join(VENDOR_DIR, binary);
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  if (fs.statSync(dest, { throwIfNoEntry: false })?.isFile()) return;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pie-bun-"));
  try {
    const zipUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${name}.zip`;
    const sumUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/SHASUMS256.txt`;
    const zipPath = path.join(tmp, `${name}.zip`);

    console.log(`Downloading ${BUN_VERSION} ${name}…`);
    curl("-o", zipPath, zipUrl);

    const expected = curl(sumUrl)
      .split("\n")
      .find((line) => line.includes(`${name}.zip`))
      ?.split(/\s+/)[0];
    if (!expected) {
      throw new Error(`No checksum for ${name}.zip`);
    }
    const actual = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${name}.zip`);
    }

    execFileSync("unzip", ["-o", zipPath, "-d", tmp], { stdio: "pipe" });
    const source = path.join(tmp, name, binary);
    fs.copyFileSync(source, dest);
    if (platform !== "win32") {
      fs.chmodSync(dest, 0o755);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** electron-builder hook: vendor the target Bun binary. */
exports.default = async function beforePack(context) {
  const arch =
    typeof context.arch === "number"
      ? ["ia32", "x64", "armv7l", "arm64", "universal"][context.arch]
      : context.arch;
  downloadBun(context.electronPlatformName, arch ?? process.arch);
};
