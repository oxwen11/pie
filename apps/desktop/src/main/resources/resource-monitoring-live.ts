import crypto from "node:crypto";

import {
  MAX_RESOURCE_CONTROL_ENTRIES,
  type ElectronProcessRegistration,
  type ElectronRegistration,
  type RuntimeSample,
} from "@getpie/contract/resource-monitoring";
import { logsDirectory, resourceSourceDirectory } from "@getpie/server/config/paths";
import { resolvePieHome } from "@getpie/server/daemon";
import {
  openResourceWriter,
  resolveResourceLoggingSetting,
  RESOURCE_SAMPLE_INTERVAL_MS,
} from "@getpie/server/observability/resources";
import { Effect, Layer, Ref } from "effect";
import { app } from "electron";

import { LocalServer } from "../server/local-server";

export const DesktopResourceMonitoringLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const setting = resolveResourceLoggingSetting(process.env);
    if (!setting.enabled) {
      if (setting.invalid) {
        yield* Effect.logWarning(
          "Electron resource monitoring disabled by invalid PIE_RESOURCE_LOGGING",
        ).pipe(Effect.annotateLogs({ event: "resources.electron.invalid_setting" }));
      }
      return;
    }

    const server = yield* LocalServer;
    const writer = yield* openResourceWriter({
      directory: resourceSourceDirectory(logsDirectory(resolvePieHome()), "electron"),
      source: "electron",
    });
    const instanceId = crypto.randomUUID();
    const latestRegistration = yield* Ref.make<ElectronRegistration | undefined>(undefined);
    let revision = 0;
    let previousAt = performance.now();

    // Prime Electron's per-window CPU counters before the first persisted round.
    app.getAppMetrics();
    const sample = Effect.sync(() => {
      const collectionStartedAt = new Date().toISOString();
      const currentAt = performance.now();
      const windowMs = currentAt - previousAt;
      previousAt = currentAt;
      const metrics = app.getAppMetrics();
      const rows = metrics.map((metric) => sampleFromMetric(metric, windowMs));
      const sampledAt = new Date().toISOString();
      writer.offer({
        source: "electron",
        sampledAt,
        collectionStartedAt,
        collectionFinishedAt: sampledAt,
        coverage: "complete",
        rows,
      });

      revision += 1;
      const processes = metrics
        .map((metric) => registrationFromMetric(metric))
        .slice(0, MAX_RESOURCE_CONTROL_ENTRIES);
      const root = processes.find((entry) => entry.process.pid === process.pid)?.process ?? {
        pid: process.pid,
      };
      return Ref.set(latestRegistration, {
        schemaVersion: 1,
        instanceId,
        revision,
        root,
        processes,
      });
    }).pipe(Effect.flatten);

    const register = Effect.gen(function* () {
      const registration = yield* Ref.get(latestRegistration);
      if (registration === undefined) return;
      const connection = yield* server.connection;
      yield* Effect.tryPromise(() =>
        fetch(`${connection.httpBaseUrl}/api/resources/electron`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${connection.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(registration),
          signal: AbortSignal.timeout(2_000),
        }).then((response) => {
          if (response.status !== 204) {
            throw new Error(`Electron resource registration returned ${response.status}`);
          }
          return undefined;
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Electron resource registration failed", error).pipe(
            Effect.annotateLogs({ event: "resources.electron.registration_failed" }),
          ),
        ),
      );
    });

    yield* sample;
    yield* Effect.forkScoped(
      Effect.forever(Effect.sleep(RESOURCE_SAMPLE_INTERVAL_MS).pipe(Effect.andThen(sample))),
    );
    yield* Effect.forkScoped(
      Effect.forever(register.pipe(Effect.andThen(Effect.sleep(RESOURCE_SAMPLE_INTERVAL_MS)))),
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Electron resource monitoring unavailable", error).pipe(
        Effect.annotateLogs({ event: "resources.electron.unavailable" }),
      ),
    ),
  ),
);

function sampleFromMetric(metric: Electron.ProcessMetric, windowMs: number): RuntimeSample {
  const role = roleFromMetric(metric);
  const memory = process.pid === metric.pid ? process.memoryUsage() : undefined;
  return {
    process: identityFromMetric(metric),
    role,
    metrics: {
      memory: {
        workingSetBytes: metric.memory.workingSetSize * 1024,
        peakWorkingSetBytes: metric.memory.peakWorkingSetSize * 1024,
        ...(metric.memory.privateBytes === undefined
          ? undefined
          : { privateBytes: metric.memory.privateBytes * 1024 }),
        ...(memory === undefined
          ? undefined
          : {
              rssBytes: memory.rss,
              heapTotalBytes: memory.heapTotal,
              heapUsedBytes: memory.heapUsed,
              externalBytes: memory.external,
              arrayBuffersBytes: memory.arrayBuffers,
            }),
      },
      cpu: { percent: metric.cpu.percentCPUUsage, windowMs },
      ...(role === "electron-main"
        ? { runtime: { name: "electron", version: process.versions.electron ?? "unknown" } }
        : undefined),
    },
  };
}

function registrationFromMetric(metric: Electron.ProcessMetric): ElectronProcessRegistration {
  return { process: identityFromMetric(metric), role: roleFromMetric(metric) };
}

function identityFromMetric(metric: Electron.ProcessMetric) {
  return {
    pid: metric.pid,
    birth: {
      value: String(Math.floor(metric.creationTime)),
      source: "electron",
      precisionMs: 1,
    },
  };
}

function roleFromMetric(metric: Electron.ProcessMetric): ElectronProcessRegistration["role"] {
  switch (metric.type) {
    case "Browser":
      return "electron-main";
    case "Tab":
      return "electron-renderer";
    case "GPU":
      return "electron-gpu";
    case "Utility":
      return "electron-utility";
    default:
      return "electron-other";
  }
}
