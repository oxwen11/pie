import type { SessionRef, TerminalConnectEvent } from "@getpie/contract";
import { Cause, Context, Effect, Layer, Queue, Semaphore, Stream } from "effect";

import { TerminalNotRunning, TerminalSpawnFailed } from "../errors";
import { spawnPty, type PtyProcess } from "./pty";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_HISTORY_BYTES = 512 * 1024;
const MAX_TERMINALS_PER_SESSION = 16;

export type TerminalConnectArgs = {
  readonly ref: SessionRef;
  readonly terminalId: string;
  readonly cwd: string;
  readonly cols?: number;
  readonly rows?: number;
};

type SubscriberQueue = Queue.Queue<TerminalConnectEvent, Cause.Done>;

type TerminalRecord = {
  readonly process: PtyProcess;
  cols: number;
  rows: number;
  history: string;
  unsubscribeData: () => void;
  unsubscribeExit: () => void;
  readonly queues: Set<SubscriberQueue>;
};

const sessionKey = (ref: SessionRef, terminalId: string): string =>
  `${ref.projectId}\0${ref.sessionId}\0${terminalId}`;

const sessionPrefix = (ref: SessionRef): string => `${ref.projectId}\0${ref.sessionId}\0`;

const notRunning = (ref: SessionRef, terminalId: string) =>
  new TerminalNotRunning({
    projectId: ref.projectId,
    sessionId: ref.sessionId,
    terminalId,
  });

const appendHistory = (current: string, chunk: string): string => {
  if (chunk.length === 0) return current;
  const next = current + chunk;
  if (Buffer.byteLength(next) <= MAX_HISTORY_BYTES) return next;
  const encoded = Buffer.from(next);
  return encoded.subarray(encoded.byteLength - MAX_HISTORY_BYTES).toString("utf8");
};

const offerAll = (record: TerminalRecord, event: TerminalConnectEvent): void => {
  for (const queue of record.queues) Queue.offerUnsafe(queue, event);
};

const endAll = (record: TerminalRecord): void => {
  for (const queue of record.queues) Queue.endUnsafe(queue);
  record.queues.clear();
};

export class TerminalManager extends Context.Service<
  TerminalManager,
  {
    readonly connect: (
      input: TerminalConnectArgs,
    ) => Effect.Effect<
      Stream.Stream<TerminalConnectEvent>,
      TerminalSpawnFailed | TerminalNotRunning
    >;
    readonly write: (
      ref: SessionRef,
      terminalId: string,
      data: string,
    ) => Effect.Effect<void, TerminalNotRunning>;
    readonly resize: (
      ref: SessionRef,
      terminalId: string,
      cols: number,
      rows: number,
    ) => Effect.Effect<void, TerminalNotRunning>;
    readonly close: (ref: SessionRef, terminalId: string) => Effect.Effect<void>;
    readonly closeAll: (ref: SessionRef) => Effect.Effect<void>;
  }
>()("pie/terminal/TerminalManager") {}

export const TerminalManagerLayer: Layer.Layer<TerminalManager> = Layer.effect(
  TerminalManager,
  Effect.gen(function* () {
    const records = new Map<string, TerminalRecord>();
    const tombstones = new Set<string>();
    const mutex = Semaphore.makeUnsafe(1);

    const countForSession = (ref: SessionRef): number => {
      const prefix = sessionPrefix(ref);
      let count = 0;
      for (const key of records.keys()) {
        if (key.startsWith(prefix)) count += 1;
      }
      return count;
    };

    const teardown = (key: string, record: TerminalRecord, exitCode: number | null): void => {
      record.unsubscribeData();
      record.unsubscribeExit();
      offerAll(record, { type: "exited", exitCode });
      endAll(record);
      records.delete(key);
    };

    const killRecord = (key: string, record: TerminalRecord): void => {
      teardown(key, record, null);
      record.process.kill();
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const [key, record] of Array.from(records.entries())) {
          killRecord(key, record);
        }
      }),
    );

    const ensureLocked = (input: TerminalConnectArgs) => {
      const key = sessionKey(input.ref, input.terminalId);
      const cols = input.cols ?? DEFAULT_COLS;
      const rows = input.rows ?? DEFAULT_ROWS;
      return Effect.gen(function* () {
        const existing = records.get(key);
        if (existing) {
          if (existing.cols !== cols || existing.rows !== rows) {
            existing.process.resize(cols, rows);
            existing.cols = cols;
            existing.rows = rows;
          }
          return existing;
        }
        if (countForSession(input.ref) >= MAX_TERMINALS_PER_SESSION) {
          return yield* new TerminalSpawnFailed({
            cwd: input.cwd,
            cause: new Error(`at most ${MAX_TERMINALS_PER_SESSION} terminals per session`),
          });
        }
        const process = yield* spawnPty({ cwd: input.cwd, cols, rows });
        const record: TerminalRecord = {
          process,
          cols,
          rows,
          history: "",
          unsubscribeData: () => {
            /* replaced immediately with process.onData */
          },
          unsubscribeExit: () => {
            /* replaced immediately with process.onExit */
          },
          queues: new Set(),
        };
        records.set(key, record);
        record.unsubscribeData = process.onData((data) => {
          record.history = appendHistory(record.history, data);
          offerAll(record, { type: "output", data });
        });
        record.unsubscribeExit = process.onExit((exitCode) => {
          teardown(key, record, exitCode);
        });
        return record;
      });
    };

    return TerminalManager.of({
      connect: (input) =>
        mutex.withPermit(
          Effect.gen(function* () {
            const key = sessionKey(input.ref, input.terminalId);
            if (tombstones.has(key)) {
              return yield* notRunning(input.ref, input.terminalId);
            }
            const record = yield* ensureLocked(input);
            const queue = yield* Queue.unbounded<TerminalConnectEvent, Cause.Done>();
            record.queues.add(queue);
            Queue.offerUnsafe(queue, { type: "snapshot", history: record.history });
            return Stream.fromQueue(queue).pipe(
              Stream.ensuring(
                Effect.sync(() => {
                  record.queues.delete(queue);
                  Queue.endUnsafe(queue);
                }),
              ),
            );
          }),
        ),
      write: (ref, terminalId, data) =>
        Effect.sync(() => records.get(sessionKey(ref, terminalId))).pipe(
          Effect.flatMap((record) =>
            record
              ? Effect.sync(() => record.process.write(data))
              : Effect.fail(notRunning(ref, terminalId)),
          ),
        ),
      resize: (ref, terminalId, cols, rows) =>
        Effect.sync(() => records.get(sessionKey(ref, terminalId))).pipe(
          Effect.flatMap((record) =>
            record
              ? Effect.sync(() => {
                  record.process.resize(cols, rows);
                  record.cols = cols;
                  record.rows = rows;
                })
              : Effect.fail(notRunning(ref, terminalId)),
          ),
        ),
      close: (ref, terminalId) => {
        const key = sessionKey(ref, terminalId);
        return mutex.withPermit(
          Effect.sync(() => {
            tombstones.add(key);
            const record = records.get(key);
            if (record) killRecord(key, record);
          }),
        );
      },
      closeAll: (ref) =>
        mutex.withPermit(
          Effect.sync(() => {
            const prefix = sessionPrefix(ref);
            for (const [key, record] of Array.from(records.entries())) {
              if (!key.startsWith(prefix)) continue;
              tombstones.add(key);
              killRecord(key, record);
            }
          }),
        ),
    });
  }),
);
