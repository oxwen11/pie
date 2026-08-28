import path from "node:path";
import url from "node:url";

import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

import { runRpcMode } from "./rpc-mode.js";
import { openSessionManager } from "./session.js";

export const PI_PROCESS_USAGE =
  "usage: pi-process --session-id <id> [--provider <name> --model <id>]";

export type PiProcessArgs = {
  sessionId: string;
  provider?: string;
  modelId?: string;
};

export function parsePiProcessArgs(argv: string[]): PiProcessArgs | { error: string } {
  let sessionId: string | undefined;
  let provider: string | undefined;
  let modelId: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--session-id" && next) {
      sessionId = next;
      i += 1;
      continue;
    }
    if (arg === "--provider" && next) {
      provider = next;
      i += 1;
      continue;
    }
    if (arg === "--model" && next) {
      modelId = next;
      i += 1;
    }
  }
  if (!sessionId) return { error: PI_PROCESS_USAGE };
  return {
    sessionId,
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
  };
}

export async function startPiProcess(args: PiProcessArgs): Promise<void> {
  const cwd = process.cwd();
  const sessionManager = await openSessionManager({ cwd, sessionId: args.sessionId });
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    sessionManager: runtimeSession,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({ cwd: runtimeCwd });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager: runtimeSession,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager,
  });
  const errors = runtime.diagnostics.filter((diagnostic) => diagnostic.type === "error");
  if (errors.length > 0) {
    for (const diagnostic of runtime.diagnostics) {
      console.error(diagnostic.message);
    }
    process.exitCode = 1;
    await runtime.dispose();
    return;
  }
  if (args.provider && args.modelId) {
    const model = runtime.session.modelRuntime
      .getAvailableSnapshot()
      .find((item) => item.provider === args.provider && item.id === args.modelId);
    if (!model) {
      console.error(`Model not found: ${args.provider}/${args.modelId}`);
      process.exitCode = 1;
      await runtime.dispose();
      return;
    }
    await runtime.session.setModel(model);
  }
  // runRpcMode owns stdin, SIGTERM/SIGHUP, dispose, and process.exit.
  await runRpcMode(runtime);
}

const invoked =
  process.argv[1] !== undefined &&
  url.fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invoked) {
  const parsed = parsePiProcessArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(1);
  } else {
    void startPiProcess(parsed).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
  }
}
