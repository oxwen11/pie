import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import piLoopExtension from "../src/index";
import { LOOP_CUSTOM_TYPE } from "../src/prompt";

type Handler = (...args: never[]) => unknown;

function fakePi() {
  const commands = new Map<string, { description?: string; handler: Handler }>();
  const tools = new Map<string, { description: string; parameters: unknown; execute: Handler }>();
  const events = new Map<string, Handler>();
  const sent: Array<{ message: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const userMessages: unknown[] = [];
  const pi = {
    on(event: string, handler: Handler) {
      events.set(event, handler);
    },
    registerCommand(name: string, options: { description?: string; handler: Handler }) {
      commands.set(name, options);
    },
    registerTool(tool: {
      name: string;
      description: string;
      parameters: unknown;
      execute: Handler;
    }) {
      tools.set(tool.name, tool);
    },
    sendMessage(message: Record<string, unknown>, options?: Record<string, unknown>) {
      sent.push({ message, options });
    },
    sendUserMessage(content: unknown) {
      userMessages.push(content);
      throw new Error("loop must not send user messages");
    },
  };
  piLoopExtension(pi as ExtensionAPI);
  return { commands, tools, events, sent, userMessages };
}

describe("extension contract", () => {
  it("registers /loop, tools, and settled lifecycle", () => {
    const { commands, tools, events } = fakePi();
    expect([...commands.keys()]).toEqual(["loop"]);
    expect([...tools.keys()]).toEqual([
      "cron_create",
      "cron_list",
      "cron_delete",
      "schedule_wakeup",
    ]);
    expect(events.has("session_start")).toBe(true);
    expect(events.has("agent_start")).toBe(true);
    expect(events.has("agent_settled")).toBe(true);
    expect(events.has("session_shutdown")).toBe(true);
    expect(events.has("agent_end")).toBe(false);
    expect(events.has("before_agent_start")).toBe(false);
    expect(events.has("input")).toBe(false);
    expect(events.has("message_end")).toBe(false);
  });

  it("uses snake_case schemas and rejects extra properties", () => {
    const { tools } = fakePi();
    const schema = tools.get("cron_create")!.parameters as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).toHaveProperty("run_at");
    expect(schema.properties).not.toHaveProperty("runAt");
  });

  it("sends customType from package.json with triggerTurn and no user-message parsing", async () => {
    expect(packageJson.name).toBe("@getpie/pi-loop");
    expect(LOOP_CUSTOM_TYPE).toBe(packageJson.name);

    const { commands, events, sent, userMessages } = fakePi();
    const ctx = {
      cwd: process.cwd(),
      isIdle: () => true,
      hasPendingMessages: () => false,
      isProjectTrusted: () => false,
      ui: { notify: () => undefined },
    };
    await events.get("session_start")!(undefined as never, ctx as never);
    await commands.get("loop")!.handler("5m ping" as never, ctx as never);
    expect(sent).toHaveLength(0);
    await events.get("session_shutdown")!(undefined as never);
    await events.get("session_start")!(undefined as never, ctx as never);
    await commands.get("loop")!.handler("check CI" as never, ctx as never);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message.customType).toBe(packageJson.name);
    expect(sent[0]!.message.customType).toBe(LOOP_CUSTOM_TYPE);
    expect(sent[0]!.options).toEqual({ triggerTurn: true });
    expect(sent[0]!.message.display).toBe(true);
    const details = sent[0]!.message.details as { prompt: string; taskId: string; kind: string };
    expect(details.prompt).toBe("check CI");
    expect(details.kind).toBe("dynamic");
    expect(details.taskId).toEqual(expect.any(String));
    expect(String(sent[0]!.message.content)).not.toContain("<system-reminder>");
    expect(String(sent[0]!.message.content)).not.toContain("<");
    expect(userMessages).toHaveLength(0);
  });
});
