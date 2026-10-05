#!/usr/bin/env node

import fs from "node:fs";
import readline from "node:readline";

if (process.argv.includes("--list-models")) {
  process.stdout.write(`provider       model         context
xai            grok-4.3      1M
cliproxyapi    gpt-5.6-sol   272K
`);
  process.exit(0);
}

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
const state = { leafId: null, nextEntry: 1 };

const bridge = process.env.PIE_SESSION_BRIDGE_URL;
const bridgeToken = process.env.PIE_SESSION_BRIDGE_TOKEN;
if (bridge && bridgeToken) {
  fetch(`${bridge}/ready`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bridgeToken}`,
      "content-type": "application/json",
    },
    body: "{}",
  }).catch(() => undefined);
}

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
  send({ type: "agent_end", messages: [last ?? assistant()], willRetry: false });
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

  // Persist entries so history reload after a live turn can decode Markdown
  // images. An empty tree is still a finished read on first attach.
  if (msg.type === "get_entries") {
    send({
      id: msg.id,
      type: "response",
      command: "get_entries",
      success: true,
      data: { entries, leafId: state.leafId },
    });
    return;
  }

  if (msg.type === "clear_queue") {
    send({
      id: msg.id,
      type: "response",
      command: "clear_queue",
      success: true,
      data: { steering: [], followUp: [] },
    });
    send({ type: "queue_update", steering: [], followUp: [] });
    return;
  }

  if (msg.type === "steer") {
    send({ id: msg.id, type: "response", command: "steer", success: true });
    send({ type: "queue_update", steering: [msg.message], followUp: [] });
    return;
  }

  if (msg.type === "follow_up") {
    send({ id: msg.id, type: "response", command: "follow_up", success: true });
    send({ type: "queue_update", steering: [], followUp: [msg.message] });
    return;
  }

  if (msg.type !== "prompt") return;

  const now = Date.now();
  const userId = `fake-user-${state.nextEntry++}`;
  const assistantId = `fake-assistant-${state.nextEntry++}`;
  entries.push({
    type: "message",
    id: userId,
    parentId: state.leafId,
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
  state.leafId = assistantId;

  send({
    id: msg.id,
    type: "response",
    command: "prompt",
    success: true,
    data: { started: true },
  });
  send({ type: "agent_start" });
  upd({ type: "start" });
  upd({ type: "text_start", contentIndex: 0 });
  upd({ type: "text_delta", contentIndex: 0, delta: configuredResponse });
  upd({ type: "text_end", contentIndex: 0, content: configuredResponse });
  send({ type: "message_end", message: finalAssistant });
  settle(finalAssistant);
});
