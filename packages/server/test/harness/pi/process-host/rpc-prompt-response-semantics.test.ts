// UPSTREAM @earendil-works/pi-coding-agent@0.84.2
// packages/coding-agent/test/rpc-prompt-response-semantics.test.ts
/* oxlint-disable pie/node-import-style, vitest/require-mock-type-parameters, anti-slop/no-module-mocking */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  EventStream,
  getModel,
  type Model,
} from "@earendil-works/pi-ai/compat";
import {
  AgentSession,
  type AgentSessionRuntime,
  createExtensionRuntime,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runRpcMode } from "../../../../src/harness/pi/process-host/rpc-mode";

const rpcIo = vi.hoisted(() => ({
  outputLines: [] as string[],
  lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../../../../src/harness/pi/process-host/output-guard.js", () => ({
  flushRawStdout: vi.fn(async () => {}),
  takeOverStdout: vi.fn(),
  waitForRawStdoutBackpressure: vi.fn(async () => {}),
  writeRawStdout: (line: string) => {
    rpcIo.outputLines.push(line);
  },
}));

vi.mock("../../../../src/harness/pi/process-host/jsonl.js", () => ({
  attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
    rpcIo.lineHandler = onLine;
    return () => {};
  }),
  serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type");
      },
    );
  }
}

function createAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createTestResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

type ParsedOutputLine = Record<string, unknown>;

function parseOutputLines(outputLines: string[]): ParsedOutputLine[] {
  return outputLines
    .flatMap((line) => line.split("\n"))
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ParsedOutputLine);
}

function getPromptResponses(outputLines: string[], id: string): ParsedOutputLine[] {
  return parseOutputLines(outputLines).filter(
    (record) => record.id === id && record.type === "response" && record.command === "prompt",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function createRuntimeHost(options: {
  withAuth: boolean;
  responseDelayMs: number;
  model?: Model<any>;
}): Promise<{
  runtimeHost: AgentSessionRuntime;
  cleanup: () => Promise<void>;
}> {
  const tempDir = join(
    tmpdir(),
    `pi-rpc-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tempDir, { recursive: true });

  const model = options.model ?? getModel("anthropic", "claude-sonnet-4-5");
  if (!model) {
    throw new Error("Test model not found");
  }

  const agent = new Agent({
    getApiKey: () => "test-key",
    initialState: {
      model,
      systemPrompt: "Test",
      tools: [],
    },
    streamFn: (_model, _context, _options) => {
      const stream = new MockAssistantStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: createAssistantMessage("") });
        setTimeout(() => {
          stream.push({ type: "done", reason: "stop", message: createAssistantMessage("done") });
        }, options.responseDelayMs);
      });
      return stream;
    },
  });

  const sessionManager = SessionManager.inMemory();
  const settingsManager = SettingsManager.create(tempDir, tempDir);
  const authPath = join(tempDir, "auth.json");
  if (options.withAuth) {
    writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "test-key" } }));
  }
  const modelRuntime = await ModelRuntime.create({
    authPath,
    modelsPath: null,
    allowModelNetwork: false,
  });

  const session = new AgentSession({
    agent,
    sessionManager,
    settingsManager,
    cwd: tempDir,
    modelRuntime,
    resourceLoader: createTestResourceLoader(),
  });

  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fake implements the methods this test exercises
  const runtimeHost = {
    session,
    newSession: vi.fn(async () => ({ cancelled: true })),
    switchSession: vi.fn(async () => ({ cancelled: true })),
    fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
    dispose: vi.fn(async () => {}),
    setRebindSession: vi.fn(),
  } as unknown as AgentSessionRuntime;

  return {
    runtimeHost,
    cleanup: async () => {
      try {
        if (session.isStreaming) {
          await session.abort();
        }
      } catch {
        // ignore test cleanup failures
      }
      session.dispose();
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true });
      }
    },
  };
}

async function startRpcMode(options: {
  withAuth: boolean;
  responseDelayMs: number;
  model?: Model<any>;
}): Promise<{
  lineHandler: (line: string) => void;
  cleanup: () => Promise<void>;
}> {
  rpcIo.outputLines = [];
  rpcIo.lineHandler = undefined;

  const { runtimeHost, cleanup } = await createRuntimeHost(options);
  void runRpcMode(runtimeHost);
  await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

  return { lineHandler: rpcIo.lineHandler!, cleanup };
}

describe("RPC prompt response semantics", () => {
  afterEach(() => {
    rpcIo.outputLines = [];
    rpcIo.lineHandler = undefined;
  });

  it("emits one failure response when prompt preflight rejects", async () => {
    const { lineHandler, cleanup } = await startRpcMode({
      withAuth: false,
      responseDelayMs: 0,
      model: {
        id: "fake-model",
        name: "Fake Model",
        api: "openai-completions",
        provider: "fake-provider",
        baseUrl: "https://example.invalid",
        reasoning: false,
        input: [],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 0,
        maxTokens: 0,
      },
    });

    try {
      lineHandler(JSON.stringify({ id: "b1", type: "prompt", message: "Hello" }));

      await vi.waitFor(() => {
        const responses = getPromptResponses(rpcIo.outputLines, "b1");
        expect(responses).toHaveLength(1);
        expect(responses[0]).toMatchObject({
          id: "b1",
          type: "response",
          command: "prompt",
          success: false,
          error: expect.stringContaining(
            "No API key found for fake-provider.\n\nUse /login to log into a provider via OAuth or API key. See:",
          ),
        });
      });
    } finally {
      await cleanup();
    }
  });

  it("emits one success response when prompt preflight succeeds", async () => {
    const { lineHandler, cleanup } = await startRpcMode({ withAuth: true, responseDelayMs: 0 });

    try {
      lineHandler(JSON.stringify({ id: "b2", type: "prompt", message: "Hello" }));

      await vi.waitFor(() => {
        const responses = getPromptResponses(rpcIo.outputLines, "b2");
        expect(responses).toHaveLength(1);
        expect(responses[0]).toMatchObject({
          id: "b2",
          type: "response",
          command: "prompt",
          success: true,
        });
      });
    } finally {
      await cleanup();
    }
  });

  it("emits one success response when prompt is queued during streaming", async () => {
    const { lineHandler, cleanup } = await startRpcMode({ withAuth: true, responseDelayMs: 100 });

    try {
      lineHandler(JSON.stringify({ id: "b3-start", type: "prompt", message: "Start" }));
      await vi.waitFor(() => {
        expect(getPromptResponses(rpcIo.outputLines, "b3-start")).toHaveLength(1);
      });

      rpcIo.outputLines = [];
      lineHandler(
        JSON.stringify({
          id: "b3",
          type: "prompt",
          message: "Queue this",
          streamingBehavior: "followUp",
        }),
      );

      await vi.waitFor(() => {
        const responses = getPromptResponses(rpcIo.outputLines, "b3");
        expect(responses).toHaveLength(1);
        expect(responses[0]).toMatchObject({
          id: "b3",
          type: "response",
          command: "prompt",
          success: true,
        });
      });

      await sleep(150);
    } finally {
      await cleanup();
    }
  });
});
