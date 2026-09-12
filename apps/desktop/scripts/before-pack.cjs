const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Pin the current latest Bun. Bump when shipping a newer runtime. */
const BUN_VERSION = "bun-v1.4.2";

const DESKTOP_DIR = path.join(__dirname, "..");
const VENDOR_BUN = path.join(DESKTOP_DIR, "vendor", "bun");

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

function download(url, dest) {
  execFileSync("curl", ["-fsSL", "--retry", "3", "--retry-delay", "2", "-o", dest, url], {
    stdio: "pipe",
  });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function downloadBun(platform, arch, destDir) {
  const name = bunDownloadName(platform, arch);
  const binary = bunBinaryName(platform);
  const dest = path.join(destDir, binary);
  fs.mkdirSync(destDir, { recursive: true });
  try {
    if (fs.statSync(dest).isFile()) return dest;
  } catch {
    // download
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pie-bun-"));
  try {
    const zipUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${name}.zip`;
    const sumUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/SHASUMS256.txt`;
    const zipPath = path.join(tmp, `${name}.zip`);
    const sumPath = path.join(tmp, "SHASUMS256.txt");

    console.log(`Downloading ${BUN_VERSION} ${name}…`);
    download(zipUrl, zipPath);
    download(sumUrl, sumPath);

    const expected = fs
      .readFileSync(sumPath, "utf8")
      .split("\n")
      .find((line) => line.includes(`${name}.zip`))
      ?.split(/\s+/)[0];
    if (!expected) {
      throw new Error(`No checksum for ${name}.zip`);
    }
    const actual = sha256(zipPath);
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${name}.zip`);
    }

    execFileSync("unzip", ["-o", zipPath, "-d", tmp], { stdio: "pipe" });
    const source = path.join(tmp, name, binary);
    fs.copyFileSync(source, dest);
    if (platform !== "win32") {
      fs.chmodSync(dest, 0o755);
    }
    return dest;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** electron-builder hook: vendor the target Bun binary. */
exports.default = async function beforePack(context) {
  downloadBun(context.electronPlatformName, context.arch ?? process.arch, VENDOR_BUN);
};
