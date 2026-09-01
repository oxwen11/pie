import fs from "node:fs";
import path from "node:path";

import { expectMeta, readRunMeta, type RunMeta } from "../meta.ts";
import { redactDaemonRecord } from "../runtime/daemon.ts";
import { appendNote, evidenceDir, stampEvidence } from "../runtime/evidence.ts";
import { usage } from "../runtime/fail.ts";
import { currentRun } from "../runtime/fs.ts";
import type { Surface } from "../surface.ts";
import { extraEvidence as cliExtra } from "../surfaces/cli.ts";
import { extraEvidence as desktopExtra } from "../surfaces/desktop.ts";
import { extraEvidence as webExtra } from "../surfaces/web.ts";
import { doctorReport } from "./doctor.ts";

export async function evidence(surface: Surface, args: string[]): Promise<void> {
  const { identity } = surface;
  const runDir = currentRun(identity.currentLink);
  if (runDir === undefined) {
    throw new Error("no current run");
  }
  const meta = readRunMeta(path.join(runDir, "meta.json"));
  if (meta.surface !== identity.id) {
    throw new Error(`meta surface is ${meta.surface}, expected ${identity.id}`);
  }
  const dest = evidenceDir(identity.skillDir, meta.runId);
  const command = args[0] ?? "path";
  const rest = args.slice(1);

  switch (command) {
    case "path":
      console.log(dest);
      return;
    case "init":
      stampEvidence(dest, runDir, await doctorReport(surface));
      if (meta.surface === "cli" || meta.surface === "desktop") {
        const record = path.join(meta.daemonDir, "daemon.pid");
        if (fs.existsSync(record)) {
          redactDaemonRecord(record, path.join(dest, "daemon.pid.redacted.json"));
        }
      }
      console.log(dest);
      return;
    case "note":
      appendNote(dest, rest.join(" "));
      return;
    default:
      if (!(await dispatchExtra(identity.id, command, rest, dest, meta))) {
        usage(evidenceUsage(identity.id));
      }
  }
}

async function dispatchExtra(
  id: Surface["identity"]["id"],
  command: string,
  rest: string[],
  dest: string,
  meta: RunMeta,
): Promise<boolean> {
  switch (id) {
    case "web":
      return webExtra(command, rest, dest, expectMeta(meta, "web"));
    case "cli":
      return cliExtra(command, rest, dest, expectMeta(meta, "cli"));
    case "desktop":
      return desktopExtra(command, rest, dest, expectMeta(meta, "desktop"));
    default: {
      const exhaustive: never = id;
      void exhaustive;
      return false;
    }
  }
}

function evidenceUsage(id: Surface["identity"]["id"]): string {
  switch (id) {
    case "web":
      return `Usage:
  pie-verify web evidence path
  pie-verify web evidence init
  pie-verify web evidence screenshot <name>
  pie-verify web evidence snapshot <name>
  pie-verify web evidence url
  pie-verify web evidence side-effects
  pie-verify web evidence note <text>`;
    case "cli":
      return `Usage:
  pie-verify cli evidence path
  pie-verify cli evidence init
  pie-verify cli evidence curl
  pie-verify cli evidence note <text>`;
    case "desktop":
      return `Usage:
  pie-verify desktop evidence path
  pie-verify desktop evidence init
  pie-verify desktop evidence screenshot <name>
  pie-verify desktop evidence snapshot <name>
  pie-verify desktop evidence curl
  pie-verify desktop evidence side-effects
  pie-verify desktop evidence note <text>`;
    default: {
      const exhaustive: never = id;
      void exhaustive;
      return "Usage:";
    }
  }
}
