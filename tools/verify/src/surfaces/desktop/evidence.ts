import fs from "node:fs";
import path from "node:path";

import { agentBrowser } from "../../runtime/browser.ts";
import { readDaemonRecord, redactDaemonRecord } from "../../runtime/daemon.ts";
import { appendNote, copySideEffects, evidenceDir, stampEvidence } from "../../runtime/evidence.ts";
import { usage } from "../../runtime/fail.ts";
import { currentRun, readJsonField, writeText } from "../../runtime/fs.ts";
import { fetchText, ticketStatus } from "../../runtime/http.ts";
import { BIN, BROWSER_SESSION, CURRENT_LINK, SKILL_DIR } from "./config.ts";
import { doctorReport } from "./doctor.ts";

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
      const record = path.join(
        readJsonField<string>(path.join(runDir, "meta.json"), "daemonDir"),
        "daemon.pid",
      );
      if (fs.existsSync(record)) {
        redactDaemonRecord(record, path.join(dest, "daemon.pid.redacted.json"));
      }
      console.log(dest);
      return;
    }
    case "screenshot": {
      const destPath = path.join(dest, `${rest[0] ?? "screen"}.png`);
      const cdpPort = readJsonField<number>(path.join(runDir, "meta.json"), "cdpPort");
      agentBrowser(["screenshot", destPath], { session: BROWSER_SESSION, cdpPort });
      console.log(destPath);
      return;
    }
    case "snapshot": {
      const destPath = path.join(dest, `${rest[0] ?? "snapshot"}.txt`);
      const cdpPort = readJsonField<number>(path.join(runDir, "meta.json"), "cdpPort");
      agentBrowser(["snapshot"], { session: BROWSER_SESSION, cdpPort, outputPath: destPath });
      console.log(destPath);
      return;
    }
    case "curl": {
      writeText(path.join(dest, "curl.txt"), await curlTranscript(runDir));
      console.log(path.join(dest, "curl.txt"));
      return;
    }
    case "side-effects": {
      const side = path.join(dest, "side-effects");
      copySideEffects(
        readJsonField<string>(path.join(runDir, "meta.json"), "pieHome"),
        side,
        false,
      );
      console.log(side);
      return;
    }
    case "note":
      appendNote(dest, rest.join(" "));
      return;
    default:
      usage(`Usage:
  pie-verify desktop evidence path
  pie-verify desktop evidence init
  pie-verify desktop evidence screenshot <name>
  pie-verify desktop evidence snapshot <name>
  pie-verify desktop evidence curl
  pie-verify desktop evidence side-effects
  pie-verify desktop evidence note <text>`);
  }
}

async function curlTranscript(runDir: string): Promise<string> {
  const meta = path.join(runDir, "meta.json");
  const record = readDaemonRecord(
    path.join(readJsonField<string>(meta, "daemonDir"), "daemon.pid"),
  );
  const cdpPort = readJsonField<number>(meta, "cdpPort");
  const health = await fetchText(`${record.address.replace(/\/$/, "")}/api/health`);
  const anon = await ticketStatus(record.address);
  const auth = await ticketStatus(record.address, record.token);
  const title = agentBrowser(["get", "title"], { session: BROWSER_SESSION, cdpPort }).trim();
  const url = agentBrowser(["get", "url"], { session: BROWSER_SESSION, cdpPort }).trim();
  return [
    `GET ${record.address}/api/health`,
    health?.body ?? "",
    "",
    `POST ${record.address}/api/ws-ticket (no token)`,
    `status ${anon ?? "error"}`,
    `POST ${record.address}/api/ws-ticket (bearer)`,
    `status ${auth ?? "error"}`,
    `${BIN} browser get title`,
    title,
    `${BIN} browser get url`,
    url,
    "",
  ].join("\n");
}
