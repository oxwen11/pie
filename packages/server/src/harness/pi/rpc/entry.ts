#!/usr/bin/env node
/**
 * Pie-owned Pi RPC child. Session construction uses the published SDK;
 * the JSONL loop is `./rpc-mode.ts` (vendored from Pi v0.85.1).
 *
 * Do not import package `runRpcMode` or spawn `./rpc-entry`: pie owns
 * extension bind/UI/protocol here, and extension loading via
 * `createAgentSessionServices` (`resourceLoaderOptions.extensionFactories`).
 */
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

// Static specifier so bun --compile inlines this (import.meta.resolve of the
// package name fails inside $bunfs). The subpath is not on the package exports.
import {
  applyHttpProxySettings,
  configureHttpDispatcher,
} from "../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js";
import { RpcChildExitError, runRpcMode } from "./rpc-mode";

process.title = "pie-pi-process";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
process.emitWarning = (() => {}) as typeof process.emitWarning;

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
  const parsed = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const bootstrapSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  applyHttpProxySettings(bootstrapSettings.getGlobalSettings().httpProxy);
  configureHttpDispatcher();
  const sessionManager = await openSessionManager(parsed.sessionId, cwd);

  const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
    const services = await createAgentSessionServices({
      cwd: options.cwd,
      agentDir: options.agentDir,
      modelRuntimeSignal: AbortSignal.timeout(15_000),
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
