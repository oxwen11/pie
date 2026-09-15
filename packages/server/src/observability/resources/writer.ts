import crypto from "node:crypto";
import workerThreads from "node:worker_threads";

import type {
  ResourceSampleRound,
  ResourceSource,
  ResourceWriterIdentity,
} from "@getpie/contract/resource-monitoring";
import { Effect, Scope } from "effect";

import { RESOURCE_LINE_LIMIT_BYTES, RESOURCE_ROUND_LIMIT_BYTES } from "./config";

export type WriterStatus = {
  readonly state: "starting" | "waiting-for-lock" | "available" | "paused" | "stopping" | "stopped";
  readonly instanceId: string;
  readonly droppedRounds: number;
  readonly lastSampledAt?: string;
  readonly lastWrittenAt?: string;
  readonly reason?: string;
};

export type ResourceWriter = {
  readonly offer: (sample: ResourceSampleRound) => boolean;
  readonly status: () => WriterStatus;
};

export type ResourceWriterWorkerData = {
  readonly directory: string;
  readonly source: ResourceSource;
  readonly writer: ResourceWriterIdentity;
};

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

export type OpenResourceWriterOptions = {
  readonly directory: string;
  readonly source: ResourceSource;
  readonly workerEntry: string | URL;
  /** Used only by source-mode tests; built products execute the worker artifact directly. */
  readonly workerExecArgv?: ReadonlyArray<string>;
};

export function openResourceWriter(
  options: OpenResourceWriterOptions,
): Effect.Effect<ResourceWriter, Error, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.try({
      try: () => makeResourceWriter(options),
      catch: (cause) => new Error("failed to start resource writer", { cause }),
    }),
    ({ close }) => Effect.promise(close).pipe(Effect.ignore),
  );
}

function makeResourceWriter(options: OpenResourceWriterOptions): ResourceWriter & {
  readonly close: () => Promise<void>;
} {
  const writerIdentity: ResourceWriterIdentity = {
    instanceId: crypto.randomUUID(),
    process: { pid: process.pid },
  };
  const worker = new workerThreads.Worker(options.workerEntry, {
    workerData: {
      directory: options.directory,
      source: options.source,
      writer: writerIdentity,
    } satisfies ResourceWriterWorkerData,
    execArgv: options.workerExecArgv === undefined ? undefined : [...options.workerExecArgv],
  });

  let state: WriterStatus["state"] = "starting";
  let reason: string | undefined;
  let sampleSequence = 0;
  let droppedRounds = 0;
  let inFlight = false;
  let lastSampledAt: string | undefined;
  let lastWrittenAt: string | undefined;
  let closePromise: Promise<void> | undefined;
  let resolveClose: (() => void) | undefined;

  worker.on("message", (message: WorkerOutput) => {
    switch (message.type) {
      case "status":
        state = message.state;
        reason = message.reason;
        break;
      case "written":
        inFlight = false;
        lastWrittenAt = message.writtenAt;
        droppedRounds -= message.droppedRounds;
        break;
      case "failed":
        inFlight = false;
        state = "paused";
        reason = message.reason;
        break;
      case "stopped":
        state = "stopped";
        resolveClose?.();
        break;
    }
  });
  worker.on("error", () => {
    state = "paused";
    reason = "worker-error";
    inFlight = false;
  });
  worker.on("exit", () => {
    if (state !== "stopped") {
      state = "stopped";
      reason ??= "worker-exited";
    }
    resolveClose?.();
  });

  return {
    offer: (sample) => {
      const sequence = sampleSequence++;
      lastSampledAt = sample.sampledAt;
      if (state !== "available" || inFlight) {
        droppedRounds += 1;
        return false;
      }

      const submittedDrops = droppedRounds;
      const payload = encodeRound(sample, writerIdentity, sequence, submittedDrops);
      if (payload === undefined) {
        droppedRounds += 1;
        return false;
      }

      inFlight = true;
      const message: WorkerInput = {
        type: "write",
        id: sequence,
        payload,
        sampledAt: sample.sampledAt,
        droppedRounds: submittedDrops,
      };
      worker.postMessage(message, []);
      return true;
    },
    status: () =>
      Object.assign(
        { state, instanceId: writerIdentity.instanceId, droppedRounds },
        lastSampledAt === undefined ? {} : { lastSampledAt },
        lastWrittenAt === undefined ? {} : { lastWrittenAt },
        reason === undefined ? {} : { reason },
      ),
    close: () => {
      if (closePromise !== undefined) return closePromise;
      state = "stopping";
      closePromise = new Promise<void>((resolve) => {
        resolveClose = resolve;
        const timeout = setTimeout(() => void worker.terminate().then(() => resolve()), 5_000);
        timeout.unref();
        worker.once("exit", () => clearTimeout(timeout));
        worker.postMessage({ type: "stop", droppedRounds } satisfies WorkerInput, []);
      });
      return closePromise;
    },
  };
}

function encodeRound(
  sample: ResourceSampleRound,
  writer: ResourceWriterIdentity,
  sampleSequence: number,
  droppedRounds: number,
): Uint8Array | undefined {
  const writtenAt = new Date().toISOString();
  const lines: string[] = [];
  let bytes = 0;
  let truncated = false;

  for (const row of sample.rows) {
    const line = jsonLine({
      ...row,
      schemaVersion: 1,
      type: sample.source === "os" ? "os_sample" : "runtime_sample",
      source: sample.source,
      writer,
      sampledAt: sample.sampledAt,
      writtenAt,
      sampleSequence,
      rowIndex: lines.length,
    });
    if (
      line === undefined ||
      bytes + Buffer.byteLength(line) + RESOURCE_LINE_LIMIT_BYTES > RESOURCE_ROUND_LIMIT_BYTES
    ) {
      truncated = true;
      continue;
    }
    lines.push(line);
    bytes += Buffer.byteLength(line);
  }

  const end = Object.assign(
    {
      schemaVersion: 1,
      type: "sample_end",
      source: sample.source,
      writer,
      sampledAt: sample.sampledAt,
      writtenAt,
      sampleSequence,
      expectedRows: lines.length,
      collectionStartedAt: sample.collectionStartedAt,
      collectionFinishedAt: sample.collectionFinishedAt,
      coverage: sample.coverage === "partial" || truncated ? "partial" : "complete",
      droppedRounds,
    },
    sample.source === "os" ? { rootRevision: sample.rootRevision } : {},
  );
  const endLine = jsonLine(end);
  if (endLine === undefined || bytes + Buffer.byteLength(endLine) > RESOURCE_ROUND_LIMIT_BYTES) {
    return undefined;
  }
  return new TextEncoder().encode(lines.join("") + endLine);
}

function jsonLine(value: unknown): string | undefined {
  const line = `${JSON.stringify(value)}\n`;
  return Buffer.byteLength(line) <= RESOURCE_LINE_LIMIT_BYTES ? line : undefined;
}
