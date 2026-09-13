#!/usr/bin/env node
/**
 * pie-pi-process. Session construction uses the published SDK;
 * the JSONL loop is `./rpc-mode.ts` (vendored from Pi v0.85.1).
 *
 * Do not import package `runRpcMode` or spawn `./rpc-entry`: pie owns
 * extension bind/UI/protocol here, and extension loading via
 * `createAgentSessionServices` (`resourceLoaderOptions.extensionFactories`).
 * Bundled `@ff-labs/pi-fff` is an additionalExtensionPath — never a static
 * import — so bun-build does not inline the native FFI graph.
 */
import path from "node:path";
import url from "node:url";

import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
  parseArgs,
  resolveCliModel,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";

import { piBashExtension } from "../bash";
import {
  applyBundledFffEnvInPlace,
  bundledFffExtensionFlags,
  isBundledFffEnabled,
  resolveBundledFffExtension,
  shouldLoadBundledFff,
  withoutUserInstalledPiFff,
} from "../fff";
import { applyFffNativeEnvInPlace, resolveFffNativeLib } from "../fff-native";
import { RpcChildExitError, runRpcMode } from "./rpc-mode";

type HttpDispatcher = {
  applyHttpProxySettings: (proxy: unknown) => void;
  configureHttpDispatcher: (idleTimeoutMs?: number) => void;
};

function isHttpDispatcher(value: unknown): value is HttpDispatcher {
  return (
    typeof value === "object" &&
    value !== null &&
    "applyHttpProxySettings" in value &&
    "configureHttpDispatcher" in value &&
    typeof value.applyHttpProxySettings === "function" &&
    typeof value.configureHttpDispatcher === "function"
  );
}

process.title = "pie-pi-process";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
applyBundledFffEnvInPlace(process.env);
applyFffNativeEnvInPlace(process.env);
process.emitWarning = () => {
  /* pie-pi-process must not leak Node experimental warnings onto the JSONL pipe */
};

const openSessionManager = async (sessionId: string | undefined, cwd: string) => {
  if (sessionId !== undefined) {
    const sessions = await SessionManager.list(cwd);
    const local = sessions.find((session) => session.id === sessionId);
    if (local) return SessionManager.open(local.path);
    return SessionManager.create(cwd, undefined, { id: sessionId });
  }
  return SessionManager.create(cwd);
};

const start = async (): Promise<void> => {
  const dispatcherUrl = url.pathToFileURL(
    path.join(
      path.dirname(url.fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),
      "core/http-dispatcher.js",
    ),
  ).href;
  const dispatcherModule: unknown = await import(dispatcherUrl);
  if (!isHttpDispatcher(dispatcherModule)) {
    throw new Error("Pi http-dispatcher export mismatch");
  }
  const { applyHttpProxySettings, configureHttpDispatcher } = dispatcherModule;
  const parsed = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const bootstrapSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  applyHttpProxySettings(bootstrapSettings.getGlobalSettings().httpProxy);
  configureHttpDispatcher();
  const sessionManager = await openSessionManager(parsed.sessionId, cwd);

  const nativeReady = resolveFffNativeLib() !== undefined;
  const bundledFff = shouldLoadBundledFff(process.env) ? resolveBundledFffExtension() : undefined;
  if (isBundledFffEnabled(process.env) && !nativeReady) {
    console.error("warning: fff native lib is not ready; Pi find/grep stay built-in");
  } else if (isBundledFffEnabled(process.env) && bundledFff === undefined) {
    console.error("warning: bundled @ff-labs/pi-fff was not found; Pi find/grep stay built-in");
  }

  const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
    const services = await createAgentSessionServices({
      cwd: options.cwd,
      agentDir: options.agentDir,
      modelRuntimeSignal: AbortSignal.timeout(15_000),
      ...(bundledFff === undefined
        ? undefined
        : { extensionFlagValues: bundledFffExtensionFlags(process.env) }),
      resourceLoaderOptions: {
        extensionFactories: [piBashExtension(options.cwd)],
        ...(bundledFff === undefined
          ? undefined
          : {
              additionalExtensionPaths: [bundledFff],
              extensionsOverride: (loaded) => withoutUserInstalledPiFff(loaded, bundledFff),
            }),
      },
    });
    const resolved = resolveCliModel({
      cliProvider: parsed.provider,
      cliModel: parsed.model,
      cliThinking: parsed.thinking,
      modelRuntime: services.modelRuntime,
    });
    if (resolved.error !== undefined) {
      throw new Error(resolved.error);
    }
    const created = await createAgentSessionFromServices({
      services,
      sessionManager: options.sessionManager,
      sessionStartEvent: options.sessionStartEvent,
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel ?? parsed.thinking,
    });
    return {
      ...created,
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: sessionManager.getCwd(),
    agentDir,
    sessionManager,
  });

  if (runtime.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
    for (const diagnostic of runtime.diagnostics) {
      console.error(`${diagnostic.type}: ${diagnostic.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const { settingsManager } = runtime.services;
  applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
  configureHttpDispatcher(settingsManager.getHttpIdleTimeoutMs());
  initTheme(settingsManager.getTheme(), false);

  await runRpcMode(runtime);
};

void start().catch((cause: unknown) => {
  if (cause instanceof RpcChildExitError) {
    process.exitCode = cause.exitCode;
    return;
  }
  console.error(cause);
  process.exitCode = 1;
});
