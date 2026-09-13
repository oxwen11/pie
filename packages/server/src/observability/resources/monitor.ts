import childProcess, { type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  RESOURCE_SCHEMA_VERSION,
  SidecarEventSchema,
  type ResourceProcessIdentity,
  type ResourceRoot,
  type SidecarCommand,
} from "@getpie/contract/resource-monitoring";
import { Effect, Exit, Schema, Scope } from "effect";

const MAX_EVENT_LINE_BYTES = 64 * 1024;
const RESTART_DELAY_MS = 1_000;
const STOP_TIMEOUT_MS = 2_000;

export type ResourceMonitorStatus = {
  readonly state: "starting" | "available" | "paused" | "stopped";
  readonly reason?: string;
  readonly process?: ResourceProcessIdentity;
  readonly rootRevision: number;
  readonly lastSampledAt?: string;
  readonly lastWrittenAt?: string;
  readonly droppedRounds: number;
};

export type ResourceMonitor = {
  readonly replaceRoots: (roots: ReadonlyArray<ResourceRoot>) => number;
  readonly status: () => ResourceMonitorStatus;
};

export type OpenResourceMonitorOptions = {
  readonly command: string;
  readonly outputDirectory: string;
  readonly owner: ResourceProcessIdentity;
  readonly sampleIntervalMs: number;
};

export const openResourceMonitor = (
  options: OpenResourceMonitorOptions,
): Effect.Effect<ResourceMonitor, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const controller = new MonitorController(options);
      controller.start();
      return controller;
    }),
    (controller) => Effect.promise(() => controller.stop()),
  );

class MonitorController implements ResourceMonitor {
  private child: ChildProcessWithoutNullStreams | undefined;
  private restartTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private eventBuffer = Buffer.alloc(0);
  private revision = 0;
  private roots: ReadonlyArray<ResourceRoot> = [];
  private current: ResourceMonitorStatus = {
    state: "starting",
    rootRevision: 0,
    droppedRounds: 0,
  };

  constructor(private readonly options: OpenResourceMonitorOptions) {}

  start(): void {
    if (this.stopped || this.child !== undefined) return;
    this.current = { ...this.current, state: "starting", reason: undefined, process: undefined };
    const child = childProcess.spawn(this.options.command, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.eventBuffer = Buffer.alloc(0);
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr.on("data", () => {
      if (this.current.state !== "available") {
        this.current = { ...this.current, state: "paused", reason: "sidecar-stderr" };
      }
    });
    child.on("error", () => {
      this.current = { ...this.current, state: "paused", reason: "sidecar-spawn" };
    });
    child.on("close", () => {
      if (this.child === child) this.child = undefined;
      if (!this.stopped) {
        this.current = {
          ...this.current,
          state: "paused",
          reason: "sidecar-exited",
          process: undefined,
        };
        this.scheduleRestart();
      }
    });
    this.send({
      schemaVersion: RESOURCE_SCHEMA_VERSION,
      type: "configure",
      owner: this.options.owner,
      outputDirectory: this.options.outputDirectory,
      sampleIntervalMs: this.options.sampleIntervalMs,
    });
  }

  replaceRoots(roots: ReadonlyArray<ResourceRoot>): number {
    this.revision += 1;
    this.roots = roots;
    if (this.current.state === "available") this.sendRoots();
    return this.revision;
  }

  status(): ResourceMonitorStatus {
    return this.current;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer);
    const child = this.child;
    if (child === undefined) {
      this.current = { ...this.current, state: "stopped", process: undefined };
      return;
    }
    this.send({ schemaVersion: RESOURCE_SCHEMA_VERSION, type: "stop" });
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, STOP_TIMEOUT_MS);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.current = { ...this.current, state: "stopped", process: undefined };
  }

  private onData(chunk: Buffer): void {
    this.eventBuffer = Buffer.concat([this.eventBuffer, chunk]);
    if (this.eventBuffer.byteLength > MAX_EVENT_LINE_BYTES && !this.eventBuffer.includes(10)) {
      this.child?.kill();
      return;
    }
    let newline = this.eventBuffer.indexOf(10);
    while (newline !== -1) {
      const line = this.eventBuffer.subarray(0, newline);
      this.eventBuffer = this.eventBuffer.subarray(newline + 1);
      if (line.byteLength > MAX_EVENT_LINE_BYTES) {
        this.child?.kill();
        return;
      }
      this.onLine(line);
      newline = this.eventBuffer.indexOf(10);
    }
  }

  private onLine(line: Buffer): void {
    let value: unknown;
    try {
      value = JSON.parse(line.toString("utf8"));
    } catch {
      this.child?.kill();
      return;
    }
    const decoded = Schema.decodeUnknownExit(SidecarEventSchema)(value);
    if (!Exit.isSuccess(decoded)) {
      this.child?.kill();
      return;
    }
    const event = decoded.value;
    if (event.type === "ready") {
      this.current = {
        ...this.current,
        state: "available",
        reason: undefined,
        process: event.process,
      };
      this.sendRoots();
      return;
    }
    if (event.type === "roots_applied") {
      this.current = { ...this.current, rootRevision: event.revision };
      return;
    }
    this.current = {
      ...this.current,
      state: event.status === "available" ? "available" : "paused",
      reason: event.reason,
      lastSampledAt: event.lastSampledAt,
      lastWrittenAt: event.lastWrittenAt,
      droppedRounds: event.droppedRounds,
    };
  }

  private sendRoots(): void {
    this.send({
      schemaVersion: RESOURCE_SCHEMA_VERSION,
      type: "replace_roots",
      revision: this.revision,
      roots: [...this.roots],
    });
  }

  private send(command: SidecarCommand): void {
    const input = this.child?.stdin;
    if (input?.writable !== true) return;
    input.write(`${JSON.stringify(command)}\n`);
  }

  private scheduleRestart(): void {
    if (this.restartTimer !== undefined || this.stopped) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start();
    }, RESTART_DELAY_MS);
    this.restartTimer.unref();
  }
}
