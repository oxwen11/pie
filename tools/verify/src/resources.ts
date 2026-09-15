import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  ResourceRecordSchema,
  type ResourceRecord,
  type ResourceSampleEndRecord,
} from "@getpie/contract/resource-monitoring";
import { Schema } from "effect";

import { readRunMeta } from "./meta.ts";
import { daemonPidPath, readDaemonRecord } from "./runtime/daemon.ts";
import { evidenceDir } from "./runtime/evidence.ts";
import { currentRun } from "./runtime/fs.ts";
import { pidAlive, readPidFile, sleep } from "./runtime/process.ts";
import type { Surface } from "./surface.ts";

const RESOURCE_WAIT_MS = 25_000;
const SAMPLE_INTERVAL_MS = 5_000;
const STALL_MS = 16_000;
const SOURCE_LIMIT_BYTES = 64 * 1024 * 1024;
const FIXTURE_FILE_BYTES = 16 * 1024 * 1024 - 1024;

type Source = "os" | "daemon" | "electron";
type SampleRecord = Extract<ResourceRecord, { type: "os_sample" | "runtime_sample" }>;

type CompleteRound = {
  end: ResourceSampleEndRecord;
  rows: SampleRecord[];
};

type SourceSnapshot = {
  source: Source;
  files: Array<{ path: string; bytes: number }>;
  records: ResourceRecord[];
  complete: CompleteRound[];
};

export async function verifyResources(surface: Surface, args: string[]): Promise<void> {
  const runDir = currentRun(surface.identity.currentLink);
  if (runDir === undefined) throw new Error("no current run");
  const meta = readRunMeta(path.join(runDir, "meta.json"));
  if (meta.surface !== surface.identity.id) {
    throw new Error(`meta surface is ${meta.surface}, expected ${surface.identity.id}`);
  }
  const testCase = args[0] ?? "live";
  const result =
    testCase === "disabled"
      ? await verifyDisabled(meta.pieHome, daemonPid(meta, runDir))
      : testCase === "live"
        ? await verifyLive(meta.pieHome, daemonPid(meta, runDir), meta.surface === "desktop")
        : testCase === "stall"
          ? await verifyStall(meta.pieHome, daemonPid(meta, runDir), meta.surface === "desktop")
          : testCase === "restart"
            ? await verifyRestart(meta.pieHome, daemonPid(meta, runDir), meta.surface === "desktop")
            : testCase === "storage"
              ? await verifyStorage(meta.pieHome, daemonPid(meta, runDir))
              : undefined;
  if (result === undefined) {
    throw new Error("resources case must be live, stall, restart, storage, or disabled");
  }
  const destination = evidenceDir(surface.identity.skillDir, meta.runId);
  fs.mkdirSync(destination, { recursive: true });
  const output = path.join(destination, `resources-${testCase}.json`);
  fs.writeFileSync(output, `${JSON.stringify(result, undefined, 2)}\n`, { mode: 0o600 });
  console.log(`${surface.identity.logPrefix} resources ${testCase}: OK`);
  console.log(`  evidence ${output}`);
}

async function verifyLive(pieHome: string, processId: number, desktop: boolean) {
  const required: Source[] = desktop ? ["os", "daemon", "electron"] : ["os", "daemon"];
  const snapshots = await waitForSources(
    pieHome,
    required,
    (source) => source.complete.length >= 2,
  );
  const daemon = snapshots.find((snapshot) => snapshot.source === "daemon");
  const os = snapshots.find((snapshot) => snapshot.source === "os");
  requireRole(daemon, "daemon", processId);
  requireRole(os, "daemon", processId);
  if (!os?.complete.some((round) => round.rows.some((row) => row.role === "sidecar"))) {
    throw new Error("OS samples do not contain the resource-monitor sidecar");
  }
  if (desktop) {
    const electron = snapshots.find((snapshot) => snapshot.source === "electron");
    const electronPid =
      electron === undefined ? undefined : latestRolePid(electron, "electron-main");
    if (electronPid === undefined || !pidAlive(electronPid)) {
      throw new Error("Electron samples do not contain a live electron-main");
    }
    requireRole(os, "electron-main", electronPid);
  }
  for (const snapshot of snapshots) validateMetrics(snapshot);
  return { case: "live", processId, sources: snapshots.map(summarize) };
}

async function verifyStall(pieHome: string, processId: number, desktop: boolean) {
  if (process.platform === "win32") throw new Error("stall verification requires SIGSTOP");
  const required: Source[] = desktop ? ["os", "daemon", "electron"] : ["os", "daemon"];
  const before = await waitForSources(pieHome, required, (source) => source.complete.length > 0);
  const beforeOs = count(before, "os");
  const beforeDaemon = count(before, "daemon");
  const beforeElectron = count(before, "electron");
  process.kill(processId, "SIGSTOP");
  let during: SourceSnapshot[];
  try {
    await sleep(STALL_MS);
    during = readSources(pieHome, required);
  } finally {
    process.kill(processId, "SIGCONT");
  }
  const duringOs = count(during, "os");
  const duringDaemon = count(during, "daemon");
  const duringElectron = count(during, "electron");
  if (duringOs <= beforeOs) throw new Error("OS samples did not continue while daemon was stopped");
  if (duringDaemon !== beforeDaemon)
    throw new Error("daemon runtime samples changed during SIGSTOP");
  if (desktop && duringElectron <= beforeElectron) {
    throw new Error("Electron samples did not continue while daemon was stopped");
  }
  const after = await waitForSources(pieHome, required, (source) =>
    source.source === "daemon" ? source.complete.length > duringDaemon : true,
  );
  return {
    case: "stall",
    processId,
    before: { os: beforeOs, daemon: beforeDaemon, electron: beforeElectron },
    during: { os: duringOs, daemon: duringDaemon, electron: duringElectron },
    after: {
      os: count(after, "os"),
      daemon: count(after, "daemon"),
      electron: count(after, "electron"),
    },
  };
}

async function verifyRestart(pieHome: string, processId: number, desktop: boolean) {
  const before = expectSource(
    await waitForSources(pieHome, ["os"], (source) => source.complete.length > 0),
    "os",
  );
  const previous = latestRolePid(before, "sidecar");
  if (previous === undefined || !pidAlive(previous)) throw new Error("live sidecar pid not found");
  const previousWriters = new Set(before.complete.map((round) => round.end.writer.instanceId));
  process.kill(previous, "SIGTERM");
  const after = expectSource(
    await waitForSources(pieHome, ["os"], (source) => {
      const replacement = latestRolePid(source, "sidecar");
      return (
        replacement !== undefined &&
        replacement !== previous &&
        pidAlive(replacement) &&
        source.complete.some((round) => !previousWriters.has(round.end.writer.instanceId))
      );
    }),
    "os",
  );
  const replacement = latestRolePid(after, "sidecar");
  requireRole(after, "daemon", processId);
  if (desktop) {
    const electron = expectSource(readSources(pieHome, ["electron"]), "electron");
    const electronPid = latestRolePid(electron, "electron-main");
    if (electronPid === undefined) throw new Error("Electron main pid not found after restart");
    requireRole(after, "electron-main", electronPid);
  }
  return {
    case: "restart",
    processId,
    previousSidecarPid: previous,
    replacementSidecarPid: replacement,
    sources: [summarize(after)],
  };
}

async function verifyStorage(pieHome: string, processId: number) {
  if (process.platform === "win32") throw new Error("storage verification requires SIGSTOP");
  const directory = path.join(pieHome, "logs", "resources", "os");
  const before = expectSource(
    await waitForSources(pieHome, ["os"], (source) => source.complete.length > 0),
    "os",
  );
  const sidecar = latestRolePid(before, "sidecar");
  if (sidecar === undefined || !pidAlive(sidecar)) throw new Error("live sidecar pid not found");
  const previousWriters = new Set(before.complete.map((round) => round.end.writer.instanceId));
  process.kill(processId, "SIGSTOP");
  try {
    process.kill(sidecar, "SIGTERM");
    await waitForDead(sidecar);
    const fixtures = Array.from({ length: 4 }, (_, index) =>
      writeHistoricalFixture(directory, 6 - index, FIXTURE_FILE_BYTES),
    );
    const expired = writeHistoricalFixture(directory, 8, 4 * 1024);
    const knownFiles = new Set([...before.files.map((file) => file.path), ...fixtures, expired]);
    process.kill(processId, "SIGCONT");
    const after = await waitForNewOsRound(directory, knownFiles, previousWriters);
    const inventory = jsonlInventory(directory);
    const totalBytes = inventory.reduce((total, file) => total + file.bytes, 0);
    if (totalBytes > SOURCE_LIMIT_BYTES) {
      throw new Error(`OS source remains above quota: ${totalBytes}`);
    }
    if (fs.existsSync(expired)) throw new Error("expired resource fixture was not deleted");
    const retainedFixtures = fixtures.filter((fixture) => fs.existsSync(fixture));
    if (retainedFixtures.length >= fixtures.length) {
      throw new Error("source pressure did not evict an old closed file");
    }
    return {
      case: "storage",
      processId,
      totalBytes,
      limitBytes: SOURCE_LIMIT_BYTES,
      evictedFixtures: fixtures.length - retainedFixtures.length,
      inventory,
      sources: [summarize(after)],
    };
  } finally {
    try {
      process.kill(processId, "SIGCONT");
    } catch {
      // daemon may have exited
    }
  }
}

async function verifyDisabled(pieHome: string, processId: number) {
  const directory = path.join(pieHome, "logs", "resources");
  if (fs.existsSync(directory))
    throw new Error(`resource directory exists while disabled: ${directory}`);
  requireNoSidecar(processId);

  const sources: Source[] = ["os", "daemon", "electron"];
  const fixtures = sources.map((source) => {
    const sourceDirectory = path.join(directory, source);
    fs.mkdirSync(sourceDirectory, { recursive: true, mode: 0o700 });
    return writeHistoricalFixture(sourceDirectory, 6, 4 * 1024, source);
  });
  const before = fixtures.map((fixture) => ({
    path: fixture,
    bytes: fs.statSync(fixture).size,
    modifiedAt: fs.statSync(fixture).mtimeMs,
  }));
  await sleep(SAMPLE_INTERVAL_MS + 1_000);
  requireNoSidecar(processId);
  for (const fixture of before) {
    const current = fs.statSync(fixture.path);
    if (current.size !== fixture.bytes || current.mtimeMs !== fixture.modifiedAt) {
      throw new Error(`disabled monitoring changed historical fixture: ${fixture.path}`);
    }
  }
  const files = sources.flatMap((source) =>
    fs.readdirSync(path.join(directory, source)).map((name) => path.join(directory, source, name)),
  );
  const unexpected = files.filter((file) => !fixtures.includes(file));
  if (unexpected.length > 0) {
    throw new Error(`disabled monitoring created resource files: ${unexpected.join(", ")}`);
  }
  return {
    case: "disabled",
    processId,
    freshHome: { resourceDirectory: "absent", sidecar: "absent" },
    historicalHome: { fixtures: before, unchanged: true, sidecar: "absent" },
  };
}

function requireNoSidecar(processId: number): void {
  const descendants = childProcess.spawnSync("pgrep", ["-P", String(processId)], {
    encoding: "utf8",
  });
  for (const value of descendants.stdout.split(/\s+/)) {
    const pid = Number(value);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const command = childProcess
      .spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" })
      .stdout.trim();
    if (command.includes("resource-monitor"))
      throw new Error(`sidecar ${pid} exists while disabled`);
  }
}

async function waitForSources(
  pieHome: string,
  sources: Source[],
  ready: (source: SourceSnapshot) => boolean,
): Promise<SourceSnapshot[]> {
  const deadline = Date.now() + RESOURCE_WAIT_MS;
  let snapshots: SourceSnapshot[] = [];
  while (Date.now() < deadline) {
    snapshots = readSources(pieHome, sources);
    if (snapshots.length === sources.length && snapshots.every(ready)) return snapshots;
    await sleep(250);
  }
  throw new Error(
    `timed out waiting for resource rounds: ${snapshots.map((source) => `${source.source}=${source.complete.length}`).join(", ")}`,
  );
}

function writeHistoricalFixture(
  directory: string,
  daysAgo: number,
  targetBytes: number,
  source: Source = "os",
): string {
  const timestamp = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1_000).toISOString();
  const writer = { instanceId: crypto.randomUUID(), process: { pid: 1 } };
  const header = `${JSON.stringify({
    schemaVersion: 1,
    type: "file_start",
    source,
    writer,
    writtenAt: timestamp,
    createdAt: timestamp,
    retentionStartAt: timestamp,
  })}\n`;
  const status = `${JSON.stringify({
    schemaVersion: 1,
    type: "collector_status",
    source,
    writer,
    writtenAt: timestamp,
    status: "stopped",
    reason: "pie-verify-storage-fixture",
    droppedRounds: 0,
  })}\n`;
  const repeats = Math.max(
    0,
    Math.floor((targetBytes - Buffer.byteLength(header)) / Buffer.byteLength(status)),
  );
  const pathname = path.join(directory, `${timestamp.replaceAll(":", "-")}.jsonl`);
  fs.writeFileSync(pathname, header + status.repeat(repeats), { flag: "wx", mode: 0o600 });
  return pathname;
}

function jsonlInventory(directory: string): Array<{ path: string; bytes: number }> {
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .toSorted()
    .map((name) => {
      const pathname = path.join(directory, name);
      return { path: pathname, bytes: fs.statSync(pathname).size };
    });
}

async function waitForDead(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (pidAlive(pid) && processState(pid) !== "Z") {
    if (Date.now() >= deadline) throw new Error(`pid ${pid} did not exit`);
    await sleep(50);
  }
}

function processState(pid: number): string | undefined {
  const output = childProcess
    .spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" })
    .stdout.trim();
  return output[0];
}

async function waitForNewOsRound(
  directory: string,
  knownFiles: ReadonlySet<string>,
  previousWriters: ReadonlySet<string>,
): Promise<SourceSnapshot> {
  const deadline = Date.now() + RESOURCE_WAIT_MS;
  while (Date.now() < deadline) {
    const files = jsonlInventory(directory).filter((file) => !knownFiles.has(file.path));
    const records = files.flatMap((file) => readRecords(file.path));
    const complete = completeRounds(records);
    if (complete.some((round) => !previousWriters.has(round.end.writer.instanceId))) {
      return { source: "os", files, records, complete };
    }
    await sleep(250);
  }
  throw new Error("timed out waiting for OS writer recovery under source pressure");
}

function readSources(pieHome: string, sources: Source[]): SourceSnapshot[] {
  return sources.flatMap((source) => {
    const directory = path.join(pieHome, "logs", "resources", source);
    if (!fs.existsSync(directory)) return [];
    const files = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".jsonl"))
      .toSorted()
      .map((name) => {
        const pathname = path.join(directory, name);
        return { path: pathname, bytes: fs.statSync(pathname).size };
      });
    const records = files.flatMap((file) => readRecords(file.path));
    return [{ source, files, records, complete: completeRounds(records) }];
  });
}

function readRecords(file: string): ResourceRecord[] {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n").slice(0, -1);
  return lines.filter(Boolean).map((line, index) => {
    try {
      return Schema.decodeUnknownSync(ResourceRecordSchema)(JSON.parse(line));
    } catch (error) {
      throw new Error(`invalid resource record ${file}:${index + 1}`, { cause: error });
    }
  });
}

function completeRounds(records: ResourceRecord[]): CompleteRound[] {
  const samples = records.filter(
    (record): record is SampleRecord =>
      record.type === "os_sample" || record.type === "runtime_sample",
  );
  return records.flatMap((record) => {
    if (record.type !== "sample_end") return [];
    const rows = samples
      .filter(
        (sample) =>
          sample.source === record.source &&
          sample.writer.instanceId === record.writer.instanceId &&
          sample.sampleSequence === record.sampleSequence,
      )
      .toSorted((left, right) => left.rowIndex - right.rowIndex);
    if (
      rows.length !== record.expectedRows ||
      rows.some((row, index) => row.rowIndex !== index) ||
      record.coverage !== "complete"
    ) {
      return [];
    }
    return [{ end: record, rows }];
  });
}

function validateMetrics(snapshot: SourceSnapshot): void {
  for (const round of snapshot.complete) {
    for (const row of round.rows) {
      if (row.type === "os_sample") {
        if (!Number.isFinite(row.metrics.rssBytes) || row.metrics.rssBytes <= 0) {
          throw new Error(`invalid OS RSS for pid ${row.process.pid}`);
        }
        if (row.metrics.cpuPercent !== undefined && !Number.isFinite(row.metrics.cpuPercent)) {
          throw new Error(`invalid OS CPU for pid ${row.process.pid}`);
        }
      } else {
        const residentBytes = row.metrics.memory?.rssBytes ?? row.metrics.memory?.workingSetBytes;
        if (residentBytes === undefined || !Number.isFinite(residentBytes) || residentBytes <= 0) {
          throw new Error(`invalid runtime resident memory for pid ${row.process.pid}`);
        }
        if (row.metrics.cpu !== undefined && !Number.isFinite(row.metrics.cpu.percent)) {
          throw new Error(`invalid runtime CPU for pid ${row.process.pid}`);
        }
      }
    }
  }
}

function requireRole(snapshot: SourceSnapshot | undefined, role: string, pid: number): void {
  if (
    !snapshot?.complete.some((round) =>
      round.rows.some((row) => row.role === role && row.process.pid === pid),
    )
  ) {
    throw new Error(`${snapshot?.source ?? "missing"} samples do not contain ${role} pid ${pid}`);
  }
}

function latestRolePid(snapshot: SourceSnapshot, role: string): number | undefined {
  return snapshot.complete
    .toSorted((left, right) => left.end.sampledAt.localeCompare(right.end.sampledAt))
    .at(-1)
    ?.rows.find((row) => row.role === role)?.process.pid;
}

function count(snapshots: SourceSnapshot[], source: Source): number {
  return snapshots.find((snapshot) => snapshot.source === source)?.complete.length ?? 0;
}

function expectSource(snapshots: SourceSnapshot[], source: Source): SourceSnapshot {
  const snapshot = snapshots.find((candidate) => candidate.source === source);
  if (snapshot === undefined) throw new Error(`missing ${source} resource source`);
  return snapshot;
}

function summarize(snapshot: SourceSnapshot) {
  const latest = snapshot.complete.at(-1);
  return {
    source: snapshot.source,
    files: snapshot.files,
    completeRounds: snapshot.complete.length,
    writerInstanceIds: [...new Set(snapshot.complete.map((round) => round.end.writer.instanceId))],
    latestSampledAt: latest?.end.sampledAt,
    roles: [...new Set(snapshot.complete.flatMap((round) => round.rows.map((row) => row.role)))],
    pids: [
      ...new Set(snapshot.complete.flatMap((round) => round.rows.map((row) => row.process.pid))),
    ],
  };
}

function daemonPid(meta: ReturnType<typeof readRunMeta>, runDir: string): number {
  const pid =
    meta.surface === "cli" && meta.mode === "serve"
      ? readPidFile(path.join(runDir, "pids", "serve.pid"))
      : meta.surface === "web"
        ? readPidFile(path.join(runDir, "pids", "server.pid"))
        : readDaemonRecord(daemonPidPath(meta.pieHome)).pid;
  if (pid === undefined || !pidAlive(pid)) throw new Error("live server pid not found");
  return pid;
}
