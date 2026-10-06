import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";

import { makeEventBus } from "../../src/events/event-bus";
import { makePiAgentSession } from "../../src/harness/session";
import { readPiSessionFile } from "../../src/pi/session-file";

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

  const read = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* makeEventBus();
        let reads = 0;
        const session = yield* makePiAgentSession(
          { projectId: "p", sessionId: "s" },
          bus,
          (agentSessionId, sessionCwd) => {
            reads += 1;
            return readPiSessionFile(agentSessionId, sessionCwd);
          },
        );
        const first = yield* session.messages("agent-1", cwd);
        const model = yield* session.modelState("agent-1", cwd);
        const second = yield* session.messages("agent-1", cwd);
        return { first, model, second, reads };
      }),
    ),
  );
  expect(read.first.map((message) => message.parts)).toEqual([
    [{ type: "text", text: "keep" }],
    [{ type: "text", text: "stay" }],
    [{ type: "text", text: "ok", state: "done" }],
  ]);
  expect(read.second).toEqual(read.first);
  expect(read.model).toEqual({ provider: "openai", modelId: "gpt-test" });
  expect(read.reads).toBe(1);
});
