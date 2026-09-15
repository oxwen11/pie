import perfHooks from "node:perf_hooks";

import {
  MAX_RESOURCE_CONTROL_ENTRIES,
  type ElectronRegistration,
  ResourceProcessIdentity,
  ResourceRoot,
} from "@getpie/contract/resource-monitoring";
import { Context, Effect, Layer } from "effect";

import { Paths, resourceSourceDirectory } from "../../config/paths";
import { resolveResourceArtifacts } from "./artifacts";
import { RESOURCE_SAMPLE_INTERVAL_MS, resolveResourceLoggingSetting } from "./config";
import { openResourceMonitor, type ResourceMonitorStatus } from "./monitor";
import { openResourceWriter, type WriterStatus } from "./writer";

export type ResourceMonitoringService = {
  readonly enabled: boolean;
  readonly registerPi: (sessionId: string, process: ResourceProcessIdentity) => void;
  readonly unregisterPi: (sessionId: string, process: ResourceProcessIdentity) => void;
  readonly registerElectron: (registration: ElectronRegistration) => void;
  readonly status: () => {
    readonly writer?: WriterStatus;
    readonly monitor?: ResourceMonitorStatus;
  };
};

export class ResourceMonitoring extends Context.Service<
  ResourceMonitoring,
  ResourceMonitoringService
>()("ResourceMonitoring") {}

export const ResourceMonitoringDisabled: ResourceMonitoringService = {
  enabled: false,
  registerPi: () => undefined,
  unregisterPi: () => undefined,
  registerElectron: () => undefined,
  status: () => ({}),
};

export const ResourceMonitoringDiscard = Layer.succeed(
  ResourceMonitoring,
  ResourceMonitoringDisabled,
);

export const ResourceMonitoringLayer = Layer.effect(
  ResourceMonitoring,
  Effect.gen(function* () {
    const setting = resolveResourceLoggingSetting(process.env);
    if (!setting.enabled) {
      if (setting.invalid) {
        yield* Effect.logWarning(
          "resource monitoring disabled by invalid PIE_RESOURCE_LOGGING",
        ).pipe(Effect.annotateLogs({ event: "resources.invalid_setting" }));
      }
      return ResourceMonitoringDisabled;
    }

    const artifacts = resolveResourceArtifacts();
    if (artifacts === undefined) {
      yield* Effect.logWarning("resource monitoring artifacts unavailable").pipe(
        Effect.annotateLogs({ event: "resources.artifacts_unavailable" }),
      );
      return ResourceMonitoringDisabled;
    }

    const paths = yield* Paths;
    const owner = { pid: process.pid };
    const writer = yield* openResourceWriter({
      directory: resourceSourceDirectory(paths.logsDir, "daemon"),
      source: "daemon",
      workerEntry: artifacts.workerEntry,
    });
    const monitor = yield* openResourceMonitor({
      command: artifacts.monitorCommand,
      outputDirectory: resourceSourceDirectory(paths.logsDir, "os"),
      owner,
      sampleIntervalMs: RESOURCE_SAMPLE_INTERVAL_MS,
    });
    const roots = new Map<string, ResourceRoot>([["daemon", { process: owner, role: "daemon" }]]);
    monitor.replaceRoots([...roots.values()]);

    const histogram = perfHooks.monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    yield* Effect.addFinalizer(() => Effect.sync(() => histogram.disable()));
    let previousCpu = process.cpuUsage();
    let previousAt = perfHooks.performance.now();

    const sampleRuntime = Effect.sync(() => {
      const collectionStartedAt = new Date().toISOString();
      const currentAt = perfHooks.performance.now();
      const elapsedMs = currentAt - previousAt;
      previousAt = currentAt;
      const currentCpu = process.cpuUsage();
      const cpu = {
        user: currentCpu.user - previousCpu.user,
        system: currentCpu.system - previousCpu.system,
      };
      previousCpu = currentCpu;
      const memory = process.memoryUsage();
      const eventLoopAvailable = Number.isFinite(histogram.max) && histogram.max > 0;
      const sampledAt = new Date().toISOString();
      writer.offer({
        source: "daemon",
        sampledAt,
        collectionStartedAt,
        collectionFinishedAt: sampledAt,
        coverage: "complete",
        rows: [
          {
            process: owner,
            role: "daemon",
            metrics: {
              memory: {
                rssBytes: memory.rss,
                heapTotalBytes: memory.heapTotal,
                heapUsedBytes: memory.heapUsed,
                externalBytes: memory.external,
                arrayBuffersBytes: memory.arrayBuffers,
              },
              cpu: {
                percent: ((cpu.user + cpu.system) / (elapsedMs * 1_000)) * 100,
                windowMs: elapsedMs,
              },
              ...(eventLoopAvailable
                ? {
                    eventLoopDelay: {
                      p50Ms: histogram.percentile(50) / 1_000_000,
                      p99Ms: histogram.percentile(99) / 1_000_000,
                      maxMs: histogram.max / 1_000_000,
                    },
                  }
                : undefined),
              runtime: {
                name: process.versions.bun === undefined ? "node" : "bun",
                version: process.versions.bun ?? process.version,
              },
            },
            ...(eventLoopAvailable
              ? undefined
              : {
                  metricStatus: [
                    { metric: "eventLoopDelay" as const, status: "warming-up" as const },
                  ],
                }),
          },
        ],
      });
      histogram.reset();
    });
    yield* Effect.forkScoped(
      Effect.forever(Effect.sleep(RESOURCE_SAMPLE_INTERVAL_MS).pipe(Effect.andThen(sampleRuntime))),
    );

    const updateRoots = () =>
      monitor.replaceRoots([...roots.values()].slice(0, MAX_RESOURCE_CONTROL_ENTRIES));
    return {
      enabled: true,
      registerPi: (sessionId, identity) => {
        roots.set(`pi:${sessionId}`, { process: identity, role: "pi" });
        updateRoots();
      },
      unregisterPi: (sessionId, identity) => {
        const key = `pi:${sessionId}`;
        if (roots.get(key)?.process.pid !== identity.pid) return;
        roots.delete(key);
        updateRoots();
      },
      registerElectron: (registration) => {
        for (const key of roots.keys()) {
          if (key.startsWith("electron:")) roots.delete(key);
        }
        roots.set(`electron:${registration.instanceId}:main`, {
          process: registration.root,
          role: "electron-main",
        });
        for (const processEntry of registration.processes
          .filter((candidate) => candidate.process.pid !== registration.root.pid)
          .slice(0, 255)) {
          roots.set(
            `electron:${registration.instanceId}:${processEntry.process.pid}`,
            processEntry,
          );
        }
        updateRoots();
      },
      status: () => ({ writer: writer.status(), monitor: monitor.status() }),
    } satisfies ResourceMonitoringService;
  }),
);
