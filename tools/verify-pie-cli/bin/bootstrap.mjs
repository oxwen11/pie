#!/usr/bin/env node
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const packageRoot = path.dirname(import.meta.dirname);

function nodeMajor(bin) {
  const version = childProcess
    .execFileSync(bin, ["-p", "process.versions.node"], { encoding: "utf8" })
    .trim();
  return Number(version.split(".")[0]);
}

function prependPath(binDir) {
  const rest = process.env.PATH ?? "";
  if (rest === binDir || rest.startsWith(`${binDir}:`)) {
    return rest;
  }
  return rest ? `${binDir}:${rest}` : binDir;
}

export function resolveNode24() {
  if (nodeMajor(process.execPath) >= 24) {
    return { node: process.execPath, pathEnv: prependPath(path.dirname(process.execPath)) };
  }

  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm");
  const versionsDir = path.join(nvmDir, "versions/node");
  if (fs.existsSync(versionsDir)) {
    const names = fs.readdirSync(versionsDir).toSorted().toReversed();
    for (const name of names) {
      if (!/^v(2[4-9]|[3-9]\d)/.test(name)) {
        continue;
      }
      const bin = path.join(versionsDir, name, "bin/node");
      if (fs.existsSync(bin) && nodeMajor(bin) >= 24) {
        return { node: bin, pathEnv: prependPath(path.dirname(bin)) };
      }
    }
  }

  throw new Error(
    `Need Node >= 24 (PATH has ${process.versions.node}). Install with nvm and use the skill bin wrapper.`,
  );
}

function cliArgv() {
  const dist = path.join(packageRoot, "dist/cli.mjs");
  if (fs.existsSync(dist)) {
    return [dist];
  }
  return [
    "--experimental-strip-types",
    "--no-warnings=ExperimentalWarning",
    path.join(packageRoot, "src/cli.ts"),
  ];
}

function execCli(extraEnv = {}) {
  const { node, pathEnv } = resolveNode24();
  const result = childProcess.spawnSync(node, [...cliArgv(), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, PATH: pathEnv, ...extraEnv },
  });
  process.exitCode = result.status ?? 1;
}

export function bootstrapVerifyPieCli(binImportMetaUrl) {
  const skillBin = url.fileURLToPath(binImportMetaUrl);
  const skillDir = path.dirname(path.dirname(skillBin));
  execCli({
    VERIFY_PIE_CLI_SKILL_DIR: process.env.VERIFY_PIE_CLI_SKILL_DIR ?? skillDir,
    VERIFY_PIE_CLI_BIN: process.env.VERIFY_PIE_CLI_BIN ?? skillBin,
  });
}

export function bootstrapPackage() {
  execCli();
}

export function bootstrapSkill(binImportMetaUrl) {
  const { node, pathEnv } = resolveNode24();
  const skillDir = path.dirname(path.dirname(url.fileURLToPath(binImportMetaUrl)));
  const cli = path.join(skillDir, "src/cli.ts");
  const result = childProcess.spawnSync(
    node,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      cli,
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, PATH: pathEnv },
    },
  );
  process.exitCode = result.status ?? 1;
}
