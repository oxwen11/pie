import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { vendorFffDirectory } from "../../../src/config/paths";
import {
  FFF_NATIVE_VERSION,
  fffNativeTarget,
  resolveFffNativeLib,
  type FffNativeTarget,
} from "../../../src/harness/pi/fff-native";
import {
  ensureFffNativeLib,
  verifyNpmIntegrity,
  verifyShasum,
} from "../../../src/harness/pi/fff-native-download";

const linuxX64 = fffNativeTarget("linux", "x64");
if (linuxX64 === undefined) {
  throw new Error("expected locked linux-x64 fff target");
}

const packFixtureTarball = (libFile: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-pack-"));
  const pkg = path.join(root, "package");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "@ff-labs/fff-bin-linux-x64-gnu", version: FFF_NATIVE_VERSION }),
  );
  fs.writeFileSync(path.join(pkg, libFile), "fake-native-binary");
  const tarballPath = path.join(root, "pkg.tgz");
  childProcess.execFileSync("tar", ["-czf", tarballPath, "-C", root, "package"], { stdio: "pipe" });
  const tarball = fs.readFileSync(tarballPath);
  return {
    tarball,
    integrity: `sha512-${crypto.createHash("sha512").update(tarball).digest("base64")}`,
    shasum: crypto.createHash("sha1").update(tarball).digest("hex"),
  };
};

const fixtureTarget = (
  integrity: string,
  shasum: string,
  tarballUrl = "https://example.test/fff.tgz",
): FffNativeTarget => ({
  platform: "linux",
  arch: "x64",
  packageName: "@ff-labs/fff-bin-linux-x64-gnu",
  libFile: linuxX64.libFile,
  tarball: tarballUrl,
  integrity,
  shasum,
});

describe("verifyNpmIntegrity / verifyShasum", () => {
  it("accepts matching hashes and rejects mismatches", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const integrity = `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`;
    const shasum = crypto.createHash("sha1").update(bytes).digest("hex");
    expect(verifyNpmIntegrity(bytes, integrity)).toBe(true);
    expect(verifyShasum(bytes, shasum)).toBe(true);
    expect(verifyNpmIntegrity(bytes, "sha512-nope")).toBe(false);
    expect(verifyShasum(bytes, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});

describe("ensureFffNativeLib", () => {
  it("skips when PIE_FFF is the kill switch", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-dl-"));
    let fetched = false;
    const result = await ensureFffNativeLib({
      home,
      env: { PIE_FFF: "0", PIE_HOME: home },
      fetchImpl: async () => {
        fetched = true;
        return new Response("nope", { status: 500 });
      },
    });
    expect(result).toEqual({ status: "skipped", reason: "PIE_FFF kill switch" });
    expect(fetched).toBe(false);
  });

  it("returns the cached lib without fetching", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-dl-"));
    const cache = vendorFffDirectory(home);
    const pkg = path.join(cache, "node_modules", ...linuxX64.packageName.split("/"));
    fs.mkdirSync(pkg, { recursive: true });
    const lib = path.join(pkg, linuxX64.libFile);
    fs.writeFileSync(lib, "native");
    fs.writeFileSync(
      path.join(cache, "manifest.json"),
      `${JSON.stringify({
        version: FFF_NATIVE_VERSION,
        platform: linuxX64.platform,
        arch: linuxX64.arch,
        package: linuxX64.packageName,
        lib: linuxX64.libFile,
        integrity: linuxX64.integrity,
        shasum: linuxX64.shasum,
      })}\n`,
    );
    let fetched = false;
    const result = await ensureFffNativeLib({
      home,
      env: { PIE_HOME: home },
      platform: "linux",
      arch: "x64",
      fetchImpl: async () => {
        fetched = true;
        return new Response("nope", { status: 500 });
      },
    });
    expect(result).toEqual({ status: "ready", libPath: lib, source: "cache" });
    expect(fetched).toBe(false);
  });

  it("downloads, verifies, and caches a tarball for Desktop and CLI", async () => {
    const fixture = packFixtureTarball(linuxX64.libFile);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-dl-"));
    const target = fixtureTarget(fixture.integrity, fixture.shasum);
    const result = await ensureFffNativeLib({
      home,
      env: { PIE_HOME: home },
      target,
      fetchImpl: async () => new Response(fixture.tarball),
    });
    const expected = path.join(
      vendorFffDirectory(home),
      "node_modules",
      ...target.packageName.split("/"),
      target.libFile,
    );
    expect(result).toEqual({ status: "ready", libPath: expected, source: "download" });
    expect(fs.existsSync(expected)).toBe(true);
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(vendorFffDirectory(home), "manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      package: target.packageName,
      integrity: target.integrity,
    });
  });

  it("rejects a tarball whose checksum does not match", async () => {
    const fixture = packFixtureTarball(linuxX64.libFile);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-dl-"));
    const result = await ensureFffNativeLib({
      home,
      env: { PIE_HOME: home },
      target: fixtureTarget(
        "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
      fetchImpl: async () => new Response(fixture.tarball),
    });
    expect(result).toEqual({ status: "failed", reason: "checksum mismatch" });
    expect(
      resolveFffNativeLib({
        env: { PIE_HOME: home },
        home,
        platform: "linux",
        arch: "x64",
      }),
    ).toBeUndefined();
  });

  it("skips an unsupported platform without fetching", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-fff-dl-"));
    let fetched = false;
    const result = await ensureFffNativeLib({
      home,
      env: { PIE_HOME: home },
      platform: "freebsd",
      arch: "x64",
      fetchImpl: async () => {
        fetched = true;
        return new Response("nope");
      },
    });
    expect(result.status).toBe("skipped");
    expect(fetched).toBe(false);
  });
});
