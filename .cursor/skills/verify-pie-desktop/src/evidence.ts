import { existsSync } from "node:fs";
import { join } from "node:path";
import { readDaemonRecord, redactDaemonRecord } from "../../verify-runtime/src/daemon.ts";
import { agentBrowser, appendNote, copySideEffects, evidenceDir, stampEvidence } from "../../verify-runtime/src/evidence.ts";
import { usage } from "../../verify-runtime/src/fail.ts";
import { currentRun, readJsonField, writeText } from "../../verify-runtime/src/fs.ts";
import { cdpVersion, fetchText, ticketStatus } from "../../verify-runtime/src/http.ts";
import { CURRENT_LINK, SKILL_DIR } from "./config.ts";
import { doctorReport } from "./doctor.ts";

export async function evidence(args: string[]): Promise<void> {
  const runDir = currentRun(CURRENT_LINK);
  if (runDir === undefined) {
    throw new Error("no current run");
  }
  const runId = readJsonField<string>(join(runDir, "meta.json"), "runId");
  const dest = evidenceDir(SKILL_DIR, runId);
  const command = args[0] ?? "path";
  const rest = args.slice(1);

  switch (command) {
    case "path":
      console.log(dest);
      return;
    case "init": {
      stampEvidence(dest, runDir, await doctorReport());
      const record = join(readJsonField<string>(join(runDir, "meta.json"), "daemonDir"), "daemon.pid");
      if (existsSync(record)) {
        redactDaemonRecord(record, join(dest, "daemon.pid.redacted.json"));
      }
      console.log(dest);
      return;
    }
    case "screenshot": {
      const path = join(dest, `${rest[0] ?? "screen"}.png`);
      agentBrowser(["screenshot", path]);
      console.log(path);
      return;
    }
    case "snapshot": {
      const path = join(dest, `${rest[0] ?? "snapshot"}.txt`);
      agentBrowser(["snapshot"], path);
      console.log(path);
      return;
    }
    case "curl": {
      writeText(join(dest, "curl.txt"), await curlTranscript(runDir));
      console.log(join(dest, "curl.txt"));
      return;
    }
    case "side-effects": {
      const side = join(dest, "side-effects");
      copySideEffects(readJsonField<string>(join(runDir, "meta.json"), "pieHome"), side, false);
      console.log(side);
      return;
    }
    case "note":
      appendNote(dest, rest.join(" "));
      return;
    default:
      usage(`Usage:
  verify-pie-desktop evidence path
  verify-pie-desktop evidence init
  verify-pie-desktop evidence screenshot <name>
  verify-pie-desktop evidence snapshot <name>
  verify-pie-desktop evidence curl
  verify-pie-desktop evidence side-effects
  verify-pie-desktop evidence note <text>`);
  }
}

async function curlTranscript(runDir: string): Promise<string> {
  const meta = join(runDir, "meta.json");
  const record = readDaemonRecord(join(readJsonField<string>(meta, "daemonDir"), "daemon.pid"));
  const cdpPort = readJsonField<number>(meta, "cdpPort");
  const health = await fetchText(`${record.address.replace(/\/$/, "")}/api/health`);
  const anon = await ticketStatus(record.address);
  const auth = await ticketStatus(record.address, record.token);
  const version = await cdpVersion(cdpPort);
  return [
    `GET ${record.address}/api/health`,
    health?.body ?? "",
    "",
    `POST ${record.address}/api/ws-ticket (no token)`,
    `status ${anon ?? "error"}`,
    `POST ${record.address}/api/ws-ticket (bearer)`,
    `status ${auth ?? "error"}`,
    `GET http://127.0.0.1:${cdpPort}/json/version`,
    version ?? "",
    "",
  ].join("\n");
}
