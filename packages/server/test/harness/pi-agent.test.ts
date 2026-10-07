import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";

import { makeEventBus } from "../../src/events/event-bus";
import { makePiAgentSessionManager } from "../../src/harness/session-manager";
import { makePiAgent } from "../../src/pi/agent";
import { makePiProcess } from "../../src/pi/process";

const homes: string[] = [];

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

it("idle session reads reuse one SessionManager open", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pie-cold-session-"));
  homes.push(home);
  process.env.PI_CODING_AGENT_DIR = home;
  const cwd = path.join(home, "project");
  const manager = SessionManager.create(cwd, undefined, { id: "agent-1" });
  const kept = manager.appendMessage({ role: "user", content: "keep", timestamp: 0 });
  manager.appendMessage({ role: "user", content: "drop", timestamp: 1 });
  manager.branch(kept);
  manager.appendMessage({ role: "user", content: "stay", timestamp: 2 });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    stopReason: "stop",
    timestamp: 3,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  manager.appendModelChange("openai", "gpt-test");

  const open = SessionManager.open.bind(SessionManager);
  let opens = 0;
  SessionManager.open = (...args: Parameters<typeof SessionManager.open>) => {
    opens += 1;
    return open(...args);
  };
  try {
    const read = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* makePiProcess();
          const pi = yield* makePiAgent(process);
          const bus = yield* makeEventBus();
          const sessions = yield* makePiAgentSessionManager(pi, bus);
          const ref = { projectId: "p", sessionId: "s" };
          const first = yield* sessions.messages(ref, "agent-1", cwd);
          const model = yield* sessions.modelState(ref, "agent-1", cwd);
          const second = yield* sessions.messages(ref, "agent-1", cwd);
          return { first, model, second };
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
    );
    expect(read.first.map((message) => message.parts)).toEqual([
      [{ type: "text", text: "keep" }],
      [{ type: "text", text: "stay" }],
      [{ type: "text", text: "ok", state: "done" }],
    ]);
    expect(read.second).toEqual(read.first);
    expect(read.model).toEqual({ provider: "openai", modelId: "gpt-test" });
    expect(opens).toBe(1);
  } finally {
    SessionManager.open = open;
  }
});
