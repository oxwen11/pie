#!/usr/bin/env node

import fs from "node:fs";
import readline from "node:readline";

const send = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);

const logPath = process.env["PIE_E2E_PI_LOG"];
const configuredResponse = process.env["PIE_E2E_PI_RESPONSE"] ?? "E2E fake Pi reply";

const sidIndex = process.argv.indexOf("--session-id");
const sessionId = sidIndex === -1 ? "default-sid" : process.argv[sidIndex + 1];

function log(value) {
  if (logPath) fs.appendFileSync(logPath, `${JSON.stringify(value)}\n`);
}

const rl = readline.createInterface({ input: process.stdin });
const entries = [];
let leafId = null;
let nextEntry = 1;

process.stdout.write("pi startup banner (not json)\n");
send({
  type: "extension_ui_request",
  id: "st",
  method: "setStatus",
  statusKey: "k",
  statusText: "v",
});

const assistant = (over = {}) => ({
  role: "assistant",
  content: [],
  api: "a",
  provider: "p",
  model: "fake-pi",
  usage: { input: 1, output: 2 },
  stopReason: "stop",
  timestamp: 0,
  ...over,
});
const upd = (ev) =>
  send({ type: "message_update", message: assistant(), assistantMessageEvent: ev });
const settle = (last) => {
  send({ type: "agent_end", messages: [last || assistant()], willRetry: false });
  send({ type: "agent_settled" });
};

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  log({ direction: "input", message: msg });

  if (msg.type === "get_state") {
    send({
      id: msg.id,
      type: "response",
      command: "get_state",
      success: true,
      data: { sessionId },
    });
    return;
  }

  if (msg.type === "get_entries") {
    send({
      id: msg.id,
      type: "response",
      command: "get_entries",
      success: true,
      data: { entries, leafId },
    });
    return;
  }

  if (msg.type !== "prompt") return;

  const now = Date.now();
  const userId = `fake-user-${nextEntry++}`;
  const assistantId = `fake-assistant-${nextEntry++}`;
  entries.push({
    type: "message",
    id: userId,
    parentId: leafId,
    timestamp: new Date(now).toISOString(),
    message: { role: "user", content: msg.message, timestamp: now },
  });
  const finalAssistant = assistant({
    content: [{ type: "text", text: configuredResponse }],
    timestamp: now + 1,
  });
  entries.push({
    type: "message",
    id: assistantId,
    parentId: userId,
    timestamp: new Date(now + 1).toISOString(),
    message: finalAssistant,
  });
  leafId = assistantId;

  send({ id: msg.id, type: "response", command: "prompt", success: true });
  send({ type: "agent_start" });
  upd({ type: "start" });
  upd({ type: "text_start", contentIndex: 0 });
  upd({ type: "text_delta", contentIndex: 0, delta: configuredResponse });
  upd({ type: "text_end", contentIndex: 0, content: configuredResponse });
  send({ type: "message_end", message: finalAssistant });
  settle(finalAssistant);
});
