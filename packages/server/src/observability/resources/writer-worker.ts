import fs from "node:fs";
import path from "node:path";
import sqlite from "node:sqlite";
import workerThreads from "node:worker_threads";

import type {
  ResourceFileStartRecord,
  ResourceWriterStopRecord,
} from "@getpie/contract/resource-monitoring";

import {
  RESOURCE_FILE_COUNT_LIMIT,
  RESOURCE_FILE_LIMIT_BYTES,
  RESOURCE_FILE_OPEN_LIMIT_MS,
  RESOURCE_RECOVERY_INTERVAL_MS,
  RESOURCE_RETENTION_MS,
  RESOURCE_SAMPLE_INTERVAL_MS,
  RESOURCE_SOURCE_LIMIT_BYTES,
} from "./config";
import type { ResourceWriterWorkerData, WriterStatus } from "./writer";

type WorkerInput =
  | {
      readonly type: "write";
      readonly id: number;
      readonly payload: Uint8Array;
      readonly sampledAt: string;
      readonly droppedRounds: number;
    }
  | { readonly type: "stop"; readonly droppedRounds: number };

type WorkerOutput =
  | {
      readonly type: "status";
      readonly state: WriterStatus["state"];
      readonly reason?: string;
    }
  | {
      readonly type: "written";
      readonly id: number;
      readonly writtenAt: string;
      readonly droppedRounds: number;
    }
  | { readonly type: "failed"; readonly id: number; readonly reason: string }
  | { readonly type: "stopped" };

type ActiveFile = {
  readonly name: string;
  readonly descriptor: number;
  readonly createdAtMs: number;
  readonly retentionStartAtMs: number;
  size: number;
};

type JsonlFile = {
  readonly name: string;
  readonly size: number;
  readonly createdAtMs: number;
  readonly deletable: boolean;
};

type WorkerState = {
  database: sqlite.DatabaseSync | undefined;
  active: ActiveFile | undefined;
  stopped: boolean;
  recoveryTimer: NodeJS.Timeout | undefined;
  maintenanceAt: number;
};

const rawWorkerData: unknown = workerThreads.workerData;
const data = readWorkerData(rawWorkerData);
if (workerThreads.parentPort === null) {
  throw new Error("resource writer must run in a worker thread");
}
const port = workerThreads.parentPort;
const state: WorkerState = {
  database: undefined,
  active: undefined,
  stopped: false,
  recoveryTimer: undefined,
  maintenanceAt: 0,
};

port.on("message", (message: WorkerInput) => {
  if (message.type === "stop") {
    stop(message.droppedRounds);
    return;
  }
  if (state.database === undefined) {
    post({ type: "failed", id: message.id, reason: "writer-unavailable" });
    return;
  }
  try {
    writeRound(Buffer.from(message.payload), message.sampledAt);
    post({
      type: "written",
      id: message.id,
      writtenAt: new Date().toISOString(),
      droppedRounds: message.droppedRounds,
    });
  } catch {
    closeActive();
    post({ type: "failed", id: message.id, reason: "writer-io" });
    pauseAndRecover();
  }
});

initialize();

function initialize(): void {
  if (state.stopped) return;
  try {
    ensureDirectory();
    const next = new sqlite.DatabaseSync(path.join(data.directory, ".writer.lock"), {
      timeout: 100,
    });
    fs.chmodSync(path.join(data.directory, ".writer.lock"), 0o600);
    next.exec("BEGIN IMMEDIATE");
    state.database = next;
    maintain(Date.now());
    post({ type: "status", state: "available" });
  } catch {
    releaseLock();
    post({ type: "status", state: "waiting-for-lock", reason: "writer-lock-unavailable" });
    state.recoveryTimer = setTimeout(initialize, RESOURCE_SAMPLE_INTERVAL_MS);
    state.recoveryTimer.unref();
  }
}

function ensureDirectory(): void {
  fs.mkdirSync(data.directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(data.directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe resource directory");
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("resource directory is not owner-only");
  }
}

function writeRound(payload: Buffer, sampledAt: string): void {
  const sampledAtMs = Date.parse(sampledAt);
  if (!Number.isFinite(sampledAtMs)) throw new Error("invalid sample timestamp");
  if (payload.byteLength > RESOURCE_FILE_LIMIT_BYTES) throw new Error("round exceeds file limit");

  const now = Date.now();
  if (now >= state.maintenanceAt) maintain(now);
  if (
    state.active !== undefined &&
    (state.active.size + payload.byteLength > RESOURCE_FILE_LIMIT_BYTES ||
      now - state.active.createdAtMs >= RESOURCE_FILE_OPEN_LIMIT_MS ||
      sampledAtMs < state.active.retentionStartAtMs ||
      now >= state.active.retentionStartAtMs + RESOURCE_RETENTION_MS)
  ) {
    closeActive();
  }

  if (state.active === undefined) {
    openFile(payload.byteLength, sampledAtMs, now);
  } else if (!reserve(payload.byteLength, false)) {
    closeActive();
    openFile(payload.byteLength, sampledAtMs, now);
  }

  if (state.active === undefined) throw new Error("resource file unavailable");
  writeAll(state.active.descriptor, payload);
  state.active.size += payload.byteLength;
}

function openFile(roundBytes: number, sampledAtMs: number, now: number): void {
  const createdAt = new Date(now).toISOString();
  const retentionStartAtMs = Math.min(now, sampledAtMs);
  const header: ResourceFileStartRecord = {
    schemaVersion: 1,
    type: "file_start",
    source: data.source,
    writer: data.writer,
    writtenAt: createdAt,
    createdAt,
    retentionStartAt: new Date(retentionStartAtMs).toISOString(),
  };
  const headerBytes = Buffer.from(`${JSON.stringify(header)}\n`);
  if (headerBytes.byteLength + roundBytes > RESOURCE_FILE_LIMIT_BYTES) {
    throw new Error("round does not fit in a new resource file");
  }
  if (!reserve(headerBytes.byteLength + roundBytes, true)) {
    throw new Error("resource source quota unavailable");
  }

  const { descriptor, name } = createFile(createdAt);
  try {
    writeAll(descriptor, headerBytes);
    state.active = {
      name,
      descriptor,
      createdAtMs: now,
      retentionStartAtMs,
      size: headerBytes.byteLength,
    };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function reserve(additionalBytes: number, needsFile: boolean): boolean {
  for (;;) {
    const files = scanFiles(Date.now());
    const bytes = files.reduce((total, file) => total + file.size, 0);
    if (
      bytes + additionalBytes <= RESOURCE_SOURCE_LIMIT_BYTES &&
      files.length + (needsFile ? 1 : 0) <= RESOURCE_FILE_COUNT_LIMIT
    ) {
      return true;
    }
    const activeName = state.active?.name;
    const oldest = files
      .filter((file) => file.deletable && file.name !== activeName)
      .sort((left, right) => left.createdAtMs - right.createdAtMs)[0];
    if (oldest === undefined) return false;
    fs.unlinkSync(path.join(data.directory, oldest.name));
  }
}

function maintain(now: number): void {
  scanFiles(now);
  state.maintenanceAt = now + RESOURCE_RECOVERY_INTERVAL_MS;
}

function scanFiles(now: number): JsonlFile[] {
  const files: JsonlFile[] = [];
  for (const entry of fs.readdirSync(data.directory, { withFileTypes: true })) {
    if (!entry.name.endsWith(".jsonl")) continue;
    const pathname = path.join(data.directory, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("unsafe resource log entry");
    const stat = fs.statSync(pathname);
    const filenameTime = timeFromFilename(entry.name);
    if (filenameTime === undefined) {
      files.push({
        name: entry.name,
        size: stat.size,
        createdAtMs: stat.birthtimeMs,
        deletable: false,
      });
      continue;
    }
    if (entry.name === state.active?.name) {
      files.push({
        name: entry.name,
        size: stat.size,
        createdAtMs: filenameTime,
        deletable: false,
      });
      continue;
    }
    const retentionStartAt = retentionFromHeader(pathname, filenameTime, now);
    if (retentionStartAt === undefined || now >= retentionStartAt + RESOURCE_RETENTION_MS) {
      fs.unlinkSync(pathname);
      continue;
    }
    files.push({ name: entry.name, size: stat.size, createdAtMs: filenameTime, deletable: true });
  }
  return files;
}

function retentionFromHeader(
  pathname: string,
  filenameTime: number,
  now: number,
): number | undefined {
  const descriptor = fs.openSync(pathname, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const read = fs.readSync(descriptor, buffer, 0, buffer.byteLength, 0);
    const newline = buffer.subarray(0, read).indexOf(0x0a);
    if (newline === -1) return undefined;
    const header: unknown = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
    if (!isFileStartHeader(header)) return undefined;
    const retention = Date.parse(header.retentionStartAt);
    return header.source === data.source &&
      Number.isFinite(retention) &&
      retention <= filenameTime &&
      retention <= now
      ? retention
      : undefined;
  } catch {
    return undefined;
  } finally {
    fs.closeSync(descriptor);
  }
}

function createFile(createdAt: string) {
  const stem = createdAt.replaceAll(":", "-");
  for (let suffix = 0; ; suffix += 1) {
    const name = `${stem}${suffix === 0 ? "" : `-${suffix}`}.jsonl`;
    try {
      const descriptor = fs.openSync(path.join(data.directory, name), "wx", 0o600);
      return { descriptor, name };
    } catch (error) {
      if (!isErrno(error) || error.code !== "EEXIST") throw error;
    }
  }
}

function timeFromFilename(name: string): number | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}\.\d{3}Z)(?:-\d+)?\.jsonl$/.exec(name);
  if (match === null) return undefined;
  const value = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}`);
  return Number.isFinite(value) ? value : undefined;
}

function writeAll(descriptor: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
    if (written <= 0) throw new Error("resource log write made no progress");
    offset += written;
  }
}

function pauseAndRecover(): void {
  if (state.stopped || state.recoveryTimer !== undefined) return;
  post({ type: "status", state: "paused", reason: "writer-io" });
  state.recoveryTimer = setTimeout(() => {
    state.recoveryTimer = undefined;
    try {
      maintain(Date.now());
      post({ type: "status", state: "available" });
    } catch {
      pauseAndRecover();
    }
  }, RESOURCE_RECOVERY_INTERVAL_MS);
  state.recoveryTimer.unref();
}

function stop(droppedRounds: number): void {
  if (state.stopped) return;
  state.stopped = true;
  if (state.recoveryTimer !== undefined) clearTimeout(state.recoveryTimer);
  if (state.active !== undefined) {
    const writtenAt = new Date().toISOString();
    const record: ResourceWriterStopRecord = {
      schemaVersion: 1,
      type: "writer_stop",
      source: data.source,
      writer: data.writer,
      writtenAt,
      droppedRounds,
    };
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    if (state.active.size + bytes.byteLength <= RESOURCE_FILE_LIMIT_BYTES) {
      try {
        writeAll(state.active.descriptor, bytes);
      } catch {
        // The existing complete rounds remain readable without a stop marker.
      }
    }
  }
  closeActive();
  releaseLock();
  post({ type: "stopped" });
  port.close();
}

function closeActive(): void {
  if (state.active === undefined) return;
  fs.closeSync(state.active.descriptor);
  state.active = undefined;
}

function releaseLock(): void {
  if (state.database === undefined) return;
  try {
    state.database.exec("COMMIT");
  } catch {
    try {
      state.database.exec("ROLLBACK");
    } catch {
      // The transaction may never have started.
    }
  }
  state.database.close();
  state.database = undefined;
}

function post(message: WorkerOutput): void {
  port.postMessage(message, []);
}

function readWorkerData(value: unknown): ResourceWriterWorkerData {
  if (
    typeof value !== "object" ||
    value === null ||
    !("directory" in value) ||
    typeof value.directory !== "string" ||
    !("source" in value) ||
    (value.source !== "os" && value.source !== "daemon" && value.source !== "electron") ||
    !("writer" in value) ||
    typeof value.writer !== "object" ||
    value.writer === null ||
    !("instanceId" in value.writer) ||
    typeof value.writer.instanceId !== "string" ||
    !("process" in value.writer) ||
    typeof value.writer.process !== "object" ||
    value.writer.process === null ||
    !("pid" in value.writer.process) ||
    typeof value.writer.process.pid !== "number"
  ) {
    throw new Error("invalid resource writer worker data");
  }
  return {
    directory: value.directory,
    source: value.source,
    writer: {
      instanceId: value.writer.instanceId,
      process: { pid: value.writer.process.pid },
    },
  };
}

function isFileStartHeader(value: unknown): value is ResourceFileStartRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion === 1 &&
    "type" in value &&
    value.type === "file_start" &&
    "source" in value &&
    (value.source === "os" || value.source === "daemon" || value.source === "electron") &&
    "retentionStartAt" in value &&
    typeof value.retentionStartAt === "string"
  );
}

function isErrno(value: unknown): value is NodeJS.ErrnoException {
  return typeof value === "object" && value !== null && "code" in value;
}
