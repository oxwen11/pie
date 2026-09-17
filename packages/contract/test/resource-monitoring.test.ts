import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ElectronRegistrationSchema,
  ResourceRecordSchema,
  ResourceSampleRoundSchema,
  SidecarCommandSchema,
  SidecarEventSchema,
} from "../src/resource-monitoring";

const accepts = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

const writer = {
  instanceId: "0195b4b3-6dc4-7d41-a9ce-3ab5dcb6cc61",
  process: { pid: 123, birth: { value: "1730000000", source: "sysinfo", precisionMs: 1_000 } },
};

const sampledAt = "2026-09-12T10:30:05.000Z";
const writtenAt = "2026-09-12T10:30:05.010Z";

describe("resource JSONL records", () => {
  it("accepts a complete OS round", () => {
    expect(
      accepts(ResourceRecordSchema, {
        schemaVersion: 1,
        type: "os_sample",
        source: "os",
        writer,
        sampledAt,
        writtenAt,
        sampleSequence: 4,
        rowIndex: 0,
        process: { pid: 456, parentPid: 123 },
        role: "pi",
        metrics: { rssBytes: 12_345_678, cpuPercent: 21.5, cpuWindowMs: 5_012 },
      }),
    ).toBe(true);
    expect(
      accepts(ResourceRecordSchema, {
        schemaVersion: 1,
        type: "sample_end",
        source: "os",
        writer,
        sampledAt,
        writtenAt,
        sampleSequence: 4,
        expectedRows: 1,
        collectionStartedAt: sampledAt,
        collectionFinishedAt: writtenAt,
        coverage: "complete",
        rootRevision: 2,
        droppedRounds: 0,
      }),
    ).toBe(true);
  });

  it("accepts the round shape handed to a writer", () => {
    expect(
      accepts(ResourceSampleRoundSchema, {
        source: "daemon",
        sampledAt,
        collectionStartedAt: sampledAt,
        collectionFinishedAt: writtenAt,
        coverage: "complete",
        rows: [
          {
            process: { pid: 123 },
            role: "daemon",
            metrics: {
              memory: { rssBytes: 12_345_678, heapUsedBytes: 4_000_000 },
              eventLoopDelay: { p50Ms: 1, p99Ms: 3, maxMs: 5 },
              runtime: { name: "node", version: "v24.13.1" },
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects invalid process and metric values", () => {
    const record = {
      schemaVersion: 1,
      type: "os_sample",
      source: "os",
      writer,
      sampledAt,
      writtenAt,
      sampleSequence: 4,
      rowIndex: 0,
      process: { pid: 0 },
      role: "pi",
      metrics: { rssBytes: Number.NaN },
    };
    expect(accepts(ResourceRecordSchema, record)).toBe(false);
  });
});

describe("resource control protocol", () => {
  it("accepts bounded Electron registration and sidecar messages", () => {
    expect(
      accepts(ElectronRegistrationSchema, {
        schemaVersion: 1,
        instanceId: writer.instanceId,
        revision: 3,
        root: { pid: 900, birth: { value: "123456", source: "electron", precisionMs: 1 } },
        processes: [{ process: { pid: 901 }, role: "electron-renderer" }],
      }),
    ).toBe(true);
    expect(
      accepts(SidecarCommandSchema, {
        schemaVersion: 1,
        type: "replace_roots",
        revision: 3,
        roots: [{ process: { pid: 123 }, role: "daemon" }],
      }),
    ).toBe(true);
    expect(
      accepts(SidecarEventSchema, {
        schemaVersion: 1,
        type: "roots_applied",
        revision: 3,
      }),
    ).toBe(true);
  });

  it("rejects registrations beyond the control limit", () => {
    expect(
      accepts(ElectronRegistrationSchema, {
        schemaVersion: 1,
        instanceId: writer.instanceId,
        revision: 3,
        root: { pid: 900 },
        processes: Array.from({ length: 257 }, (_, index) => ({
          process: { pid: index + 1 },
          role: "electron-renderer",
        })),
      }),
    ).toBe(false);
  });
});
