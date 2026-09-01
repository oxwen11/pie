#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function nodeMajor(bin) {
  const version = execFileSync(bin, ["-p", "process.versions.node"], { encoding: "utf8" }).trim();
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
    return { node: process.execPath, pathEnv: prependPath(dirname(process.execPath)) };
  }

  const nvmDir = process.env.NVM_DIR ?? join(homedir(), ".nvm");
  const versionsDir = join(nvmDir, "versions/node");
  if (existsSync(versionsDir)) {
    const names = readdirSync(versionsDir).toSorted().toReversed();
    for (const name of names) {
      if (!/^v(2[4-9]|[3-9]\d)/.test(name)) {
        continue;
      }
      const bin = join(versionsDir, name, "bin/node");
      if (existsSync(bin) && nodeMajor(bin) >= 24) {
        return { node: bin, pathEnv: prependPath(dirname(bin)) };
      }
    }
  }

  throw new Error(
    `Need Node >= 24 (PATH has ${process.versions.node}). Install with nvm and use the skill bin wrapper.`,
  );
}

export function bootstrapSkill(binImportMetaUrl) {
  const { node, pathEnv } = resolveNode24();
  const skillDir = dirname(dirname(fileURLToPath(binImportMetaUrl)));
  const cli = join(skillDir, "src/cli.ts");
  const result = spawnSync(node, ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", cli, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, PATH: pathEnv },
  });
  process.exit(result.status ?? 1);
}
