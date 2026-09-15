import workerThreads from "node:worker_threads";

import { Context, Effect, Layer } from "effect";

import type { ResourceWriterWorkerData } from "./writer";

export type ResourceWorkerHandle = {
  readonly post: (message: unknown) => void;
  readonly onMessage: (callback: (message: unknown) => void) => void;
  readonly onError: (callback: () => void) => void;
  readonly onExit: (callback: () => void) => void;
  readonly terminate: () => Promise<unknown>;
};

export type ResourceWorkerSpawnInput = {
  readonly entry: string | URL;
  readonly data: ResourceWriterWorkerData;
  readonly execArgv?: ReadonlyArray<string>;
};

export class ResourceWorker extends Context.Service<
  ResourceWorker,
  {
    readonly spawn: (input: ResourceWorkerSpawnInput) => Effect.Effect<ResourceWorkerHandle, Error>;
  }
>()("pie/resources/ResourceWorker") {}

export const spawnResourceWorker = (
  input: ResourceWorkerSpawnInput,
): Effect.Effect<ResourceWorkerHandle, Error, ResourceWorker> =>
  Effect.flatMap(ResourceWorker, (worker) => worker.spawn(input));

export const NodeResourceWorkerLayer: Layer.Layer<ResourceWorker> = Layer.succeed(
  ResourceWorker,
  ResourceWorker.of({
    spawn: (input) =>
      Effect.try({
        try: () => {
          const worker = new workerThreads.Worker(input.entry, {
            workerData: input.data,
            execArgv: input.execArgv === undefined ? undefined : [...input.execArgv],
          });
          return {
            post: (message) => worker.postMessage(message, []),
            onMessage: (callback) => worker.on("message", callback),
            onError: (callback) => worker.on("error", callback),
            onExit: (callback) => worker.on("exit", callback),
            terminate: () => worker.terminate(),
          } satisfies ResourceWorkerHandle;
        },
        catch: (cause) => new Error("failed to start resource writer worker", { cause }),
      }),
  }),
);

type BunWorker = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: () => void): void;
  terminate(): void;
};

type BunWorkerConstructor = new (url: string) => BunWorker;

export const BunResourceWorkerLayer: Layer.Layer<ResourceWorker> = Layer.succeed(
  ResourceWorker,
  ResourceWorker.of({
    spawn: (input) =>
      Effect.try({
        try: () => {
          const WorkerCtor = (globalThis as typeof globalThis & { Worker?: BunWorkerConstructor })
            .Worker;
          if (WorkerCtor === undefined) throw new Error("Bun Worker is unavailable");
          const worker = new WorkerCtor(
            typeof input.entry === "string" ? input.entry : input.entry.href,
          );
          // Worker.postMessage has no targetOrigin; this is not window.postMessage.
          // oxlint-disable-next-line unicorn/require-post-message-target-origin
          worker.postMessage({ type: "configure", data: input.data });
          return {
            // oxlint-disable-next-line unicorn/require-post-message-target-origin
            post: (message) => worker.postMessage(message),
            onMessage: (callback) => {
              worker.addEventListener("message", (event) => callback(event.data));
            },
            onError: (callback) => {
              worker.addEventListener("error", callback);
            },
            onExit: (callback) => {
              worker.addEventListener("close", callback);
            },
            terminate: () => Promise.resolve(worker.terminate()),
          } satisfies ResourceWorkerHandle;
        },
        catch: (cause) => new Error("failed to start resource writer worker", { cause }),
      }),
  }),
);

export const ResourceWorkerLive: Layer.Layer<ResourceWorker> =
  "bun" in process.versions ? BunResourceWorkerLayer : NodeResourceWorkerLayer;
