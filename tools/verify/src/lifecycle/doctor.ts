import fs from "node:fs";
import path from "node:path";

import { readRunMeta } from "../meta.ts";
import { fail } from "../runtime/fail.ts";
import { currentRun } from "../runtime/fs.ts";
import { isSharedPieHome, listenPids } from "../runtime/process.ts";
import type { SurfaceDefinition } from "../surface.ts";

export async function doctor(surface: SurfaceDefinition): Promise<void> {
  process.stdout.write(await doctorReport(surface));
}

export async function doctorReport(surface: SurfaceDefinition): Promise<string> {
  const { identity } = surface;
  const runDir = currentRun(identity.currentLink);
  if (runDir === undefined) {
    const live = identity.foreignPorts.flatMap((port) => listenPids(port));
    if (live.length > 0) {
      fail(
        `${identity.logPrefix} doctor: FAIL — port(s) ${identity.foreignPorts.join("/")} are live but this is not a ${identity.skill} run (no ${identity.currentLink}). Refuse to drive a shared ~/.pie or ~/.pie-dev instance.`,
      );
    }
    fail(
      `${identity.logPrefix} doctor: FAIL — no current run. Launch first: ${identity.bin} launch`,
    );
  }

  const metaPath = path.join(runDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    fail(`${identity.logPrefix} doctor: FAIL — missing ${metaPath}`);
  }

  let meta;
  try {
    meta = readRunMeta(metaPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`${identity.logPrefix} doctor: FAIL — ${message}`);
  }
  if (meta.surface !== identity.id) {
    fail(
      `${identity.logPrefix} doctor: FAIL — meta surface is ${meta.surface}, expected ${identity.id}`,
    );
  }
  if (!fs.existsSync(meta.pieHome)) {
    fail(`${identity.logPrefix} doctor: FAIL — PIE_HOME ${meta.pieHome} is missing`);
  }
  if (isSharedPieHome(meta.pieHome)) {
    fail(
      `${identity.logPrefix} doctor: FAIL — PIE_HOME is the shared default (${meta.pieHome}). This skill only drives isolated homes.`,
    );
  }

  const extra = await surface.inspect(runDir, meta);
  return [`${identity.logPrefix} doctor: OK`, `  run     ${meta.runId}`, ...extra, ""].join("\n");
}
