import fs from "node:fs";
import path from "node:path";

import { CURRENT_LINK, SKILL_DIR } from "./config.ts";
import { doctorReport } from "./doctor.ts";
import { readDaemonRecord, redactDaemonRecord } from "./runtime/daemon.ts";
import { appendNote, evidenceDir, stampEvidence } from "./runtime/evidence.ts";
import { usage } from "./runtime/fail.ts";
import { currentRun, ensureDir, readJsonField, writeText } from "./runtime/fs.ts";
import { fetchText, ticketStatus } from "./runtime/http.ts";

export async function evidence(args: string[]): Promise<void> {
  const runDir = currentRun(CURRENT_LINK);
  if (runDir === undefined) {
    throw new Error("no current run");
  }
  const runId = readJsonField<string>(path.join(runDir, "meta.json"), "runId");
  const dest = evidenceDir(SKILL_DIR, runId);
  const command = args[0] ?? "path";
  const rest = args.slice(1);

  switch (command) {
    case "path":
      console.log(dest);
      return;
    case "init": {
      stampEvidence(dest, runDir, await doctorReport());
      const daemonDir = readJsonField<string>(path.join(runDir, "meta.json"), "daemonDir");
      const record = path.join(daemonDir, "daemon.pid");
      if (fs.existsSync(record)) {
        redactDaemonRecord(record, path.join(dest, "daemon.pid.redacted.json"));
      }
      console.log(dest);
      return;
    }
    case "curl": {
      writeText(path.join(dest, "curl.txt"), await curlTranscript(runDir));
      console.log(path.join(dest, "curl.txt"));
      return;
    }
    case "note":
      appendNote(dest, rest.join(" "));
      return;
    default:
      usage(`Usage:
  verify-pie-cli evidence path
  verify-pie-cli evidence init
  verify-pie-cli evidence curl
  verify-pie-cli evidence note <text>`);
  }
}

async function curlTranscript(runDir: string): Promise<string> {
  const meta = path.join(runDir, "meta.json");
  const mode = readJsonField<string>(meta, "mode");
  ensureDir(evidenceDir(SKILL_DIR, readJsonField<string>(meta, "runId")));
  if (mode === "serve") {
    const address = `http://127.0.0.1:${readJsonField<number>(meta, "piePort")}`;
    const health = await fetchText(`${address}/api/health`);
    const ticket = await ticketStatus(address);
    return [
      `GET ${address}/api/health`,
      health?.body ?? "",
      "",
      `POST ${address}/api/ws-ticket (no token)`,
      `status ${ticket ?? "error"}`,
      "",
    ].join("\n");
  }
  const record = readDaemonRecord(
    path.join(readJsonField<string>(meta, "daemonDir"), "daemon.pid"),
  );
  const health = await fetchText(`${record.address.replace(/\/$/, "")}/api/health`);
  const anon = await ticketStatus(record.address);
  const auth = await ticketStatus(record.address, record.token);
  return [
    `GET ${record.address}/api/health`,
    health?.body ?? "",
    "",
    `POST ${record.address}/api/ws-ticket (no token)`,
    `status ${anon ?? "error"}`,
    `POST ${record.address}/api/ws-ticket (bearer)`,
    `status ${auth ?? "error"}`,
    "",
  ].join("\n");
}
