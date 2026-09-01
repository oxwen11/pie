import { existsSync } from "node:fs";
import { join } from "node:path";
import { readDaemonRecord, redactDaemonRecord } from "../../verify-runtime/src/daemon.ts";
import { appendNote, evidenceDir, stampEvidence } from "../../verify-runtime/src/evidence.ts";
import { usage } from "../../verify-runtime/src/fail.ts";
import { currentRun, ensureDir, readJsonField, writeText } from "../../verify-runtime/src/fs.ts";
import { fetchText, ticketStatus } from "../../verify-runtime/src/http.ts";
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
      const daemonDir = readJsonField<string>(join(runDir, "meta.json"), "daemonDir");
      const record = join(daemonDir, "daemon.pid");
      if (existsSync(record)) {
        redactDaemonRecord(record, join(dest, "daemon.pid.redacted.json"));
      }
      console.log(dest);
      return;
    }
    case "curl": {
      writeText(join(dest, "curl.txt"), await curlTranscript(runDir));
      console.log(join(dest, "curl.txt"));
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
  const meta = join(runDir, "meta.json");
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
  const record = readDaemonRecord(join(readJsonField<string>(meta, "daemonDir"), "daemon.pid"));
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
