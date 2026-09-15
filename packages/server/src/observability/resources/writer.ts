import crypto from "node:crypto";

import type {
  ResourceSampleRound,
  ResourceSource,
  ResourceWriterIdentity,
} from "@getpie/contract/resource-monitoring";
import { Effect, Scope } from "effect";

import { RESOURCE_LINE_LIMIT_BYTES, RESOURCE_ROUND_LIMIT_BYTES } from "./config";
import { createResourceFileWriter } from "./writer-worker";

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

export type OpenResourceWriterOptions = {
  readonly directory: string;
  readonly source: ResourceSource;
};

export function openResourceWriter(
  options: OpenResourceWriterOptions,
): Effect.Effect<ResourceWriter, Error, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.sync(() => makeResourceWriter(options)),
    (writer) => Effect.sync(writer.close),
  );
}

function makeResourceWriter(options: OpenResourceWriterOptions): ResourceWriter & {
  readonly close: () => void;
} {
  const writerIdentity: ResourceWriterIdentity = {
    instanceId: crypto.randomUUID(),
    process: { pid: process.pid },
  };
  const session = {
    state: "starting" as WriterStatus["state"],
    reason: undefined as string | undefined,
    sampleSequence: 0,
    droppedRounds: 0,
    inFlight: false,
    lastSampledAt: undefined as string | undefined,
    lastWrittenAt: undefined as string | undefined,
    pending: undefined as (() => void) | undefined,
  };

  const file = createResourceFileWriter({
    directory: options.directory,
    source: options.source,
    writer: writerIdentity,
    onStatus: (state, reason) => {
      session.state = state;
      session.reason = reason;
    },
  });

  function flushPending(): void {
    const pending = session.pending;
    session.pending = undefined;
    pending?.();
  }

  return {
    offer: (sample) => {
      session.lastSampledAt = sample.sampledAt;
      session.sampleSequence += 1;
      const sequence = session.sampleSequence - 1;
      if (session.state !== "available" || session.inFlight) {
        session.droppedRounds += 1;
        return false;
      }

      const submittedDrops = session.droppedRounds;
      const payload = encodeRound(sample, writerIdentity, sequence, submittedDrops);
      if (payload === undefined) {
        session.droppedRounds += 1;
        return false;
      }

      session.inFlight = true;
      session.pending = () => {
        try {
          file.write(payload, sample.sampledAt);
          session.lastWrittenAt = new Date().toISOString();
          session.droppedRounds -= submittedDrops;
        } catch {
          session.state = "paused";
          session.reason = "writer-io";
        } finally {
          session.inFlight = false;
          session.pending = undefined;
        }
      };
      setImmediate(flushPending);
      return true;
    },
    status: () =>
      Object.assign(
        {
          state: session.state,
          instanceId: writerIdentity.instanceId,
          droppedRounds: session.droppedRounds,
        },
        session.lastSampledAt === undefined ? {} : { lastSampledAt: session.lastSampledAt },
        session.lastWrittenAt === undefined ? {} : { lastWrittenAt: session.lastWrittenAt },
        session.reason === undefined ? {} : { reason: session.reason },
      ),
    close: () => {
      session.state = "stopping";
      flushPending();
      file.stop(session.droppedRounds);
      session.state = "stopped";
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
