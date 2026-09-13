import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ResourceRecordSchema } from "@getpie/contract/resource-monitoring";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  openResourceWriter,
  type ResourceWriter,
} from "../../../src/observability/resources/writer";

const homes: string[] = [];
const workerEntry = new URL(
  "../../../src/observability/resources/writer-worker.ts",
  import.meta.url,
);

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pie-resource-writer-"));
  homes.push(directory);
  return directory;
}

async function waitFor(writer: ResourceWriter, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`writer timed out in ${writer.status().state}`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

describe("resource writer", () => {
  it("writes a complete round through the real worker", async () => {
    const directory = await temporaryDirectory();
    const sampledAt = new Date().toISOString();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const writer = yield* openResourceWriter({
            directory,
            source: "daemon",
            workerEntry,
            workerExecArgv: ["--import", "tsx"],
          });
          yield* Effect.promise(() => waitFor(writer, () => writer.status().state === "available"));
          expect(
            writer.offer({
              source: "daemon",
              sampledAt,
              collectionStartedAt: sampledAt,
              collectionFinishedAt: sampledAt,
              coverage: "complete",
              rows: [
                {
                  process: { pid: process.pid },
                  role: "daemon",
                  metrics: { memory: { rssBytes: 12_345_678 } },
                },
              ],
            }),
          ).toBe(true);
          yield* Effect.promise(() =>
            waitFor(writer, () => writer.status().lastWrittenAt !== undefined),
          );
        }),
      ),
    );

    const entries = await fs.readdir(directory);
    const names = entries.filter((name) => name.endsWith(".jsonl"));
    expect(names).toHaveLength(1);
    const name = names[0];
    if (name === undefined) throw new Error("resource log was not created");
    const content = await fs.readFile(path.join(directory, name), "utf8");
    const lines = content
      .trimEnd()
      .split("\n")
      .map((line) => Schema.decodeUnknownSync(ResourceRecordSchema)(JSON.parse(line)));
    expect(lines.map((line) => line.type)).toEqual([
      "file_start",
      "runtime_sample",
      "sample_end",
      "writer_stop",
    ]);
    expect(lines[2]).toMatchObject({ expectedRows: 1, coverage: "complete", droppedRounds: 0 });
  }, 15_000);

  it("rotates and evicts while continuing past the source quota", async () => {
    const directory = await temporaryDirectory();
    const startedAt = Date.now();
    const rows = Array.from({ length: 4_096 }, (_, index) => ({
      process: {
        pid: index + 1,
        birth: {
          value: `${index}`.padEnd(120, "x"),
          source: "writer-integration".padEnd(120, "x"),
          precisionMs: 1,
        },
      },
      role: "pi-descendant" as const,
      metrics: { rssBytes: index },
    }));

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const writer = yield* openResourceWriter({
            directory,
            source: "os",
            workerEntry,
            workerExecArgv: ["--import", "tsx"],
          });
          yield* Effect.promise(() => waitFor(writer, () => writer.status().state === "available"));
          for (let index = 0; index < 72; index += 1) {
            const previous = writer.status().lastWrittenAt;
            expect(
              writer.offer({
                source: "os",
                sampledAt: new Date(startedAt + index * 5_000).toISOString(),
                collectionStartedAt: new Date(startedAt).toISOString(),
                collectionFinishedAt: new Date(startedAt + 1_000).toISOString(),
                coverage: "complete",
                rootRevision: 1,
                rows,
              }),
            ).toBe(true);
            yield* Effect.promise(() =>
              waitFor(writer, () => writer.status().lastWrittenAt !== previous),
            );
          }
        }),
      ),
    );

    const entries = await fs.readdir(directory);
    const names = entries.filter((name) => name.endsWith(".jsonl"));
    const sizes = await Promise.all(
      names.map(async (name) => {
        const stat = await fs.stat(path.join(directory, name));
        return stat.size;
      }),
    );
    expect(names.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(64 * 1024 * 1024);

    const roundFiles = new Map<string, string>();
    for (const name of names) {
      const content = await fs.readFile(path.join(directory, name), "utf8");
      for (const line of content.trimEnd().split("\n")) {
        const record = Schema.decodeUnknownSync(ResourceRecordSchema)(JSON.parse(line));
        if (!("sampleSequence" in record)) continue;
        const key = `${record.writer.instanceId}:${record.sampleSequence}`;
        expect(roundFiles.get(key) ?? name).toBe(name);
        roundFiles.set(key, name);
      }
    }
    expect(roundFiles.size).toBeGreaterThan(50);
  }, 60_000);
});
