import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import url from "node:url";

import { describe, it } from "vitest";

const extension = url.fileURLToPath(new URL("./fixtures/loadout-extension.mjs", import.meta.url));
const cli = url.fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
);

type Frame = Record<string, unknown>;

function startPi(dir: string, args: ReadonlyArray<string>) {
  const child = childProcess.spawn(
    process.execPath,
    [
      cli,
      "--mode",
      "rpc",
      "--offline",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "--no-themes",
      "--extension",
      extension,
      ...args,
    ],
    {
      cwd: dir,
      env: { ...process.env, PI_CODING_AGENT_DIR: dir },
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  const waiters: Array<{ match: (frame: Frame) => boolean; resolve: (frame: Frame) => void }> = [];
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let frame: Frame;
    try {
      frame = JSON.parse(line) as Frame;
    } catch {
      return;
    }
    for (const waiter of waiters.filter((w) => w.match(frame))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  });
  const next = (match: (frame: Frame) => boolean) =>
    new Promise<Frame>((resolve) => {
      waiters.push({ match, resolve });
    });
  let id = 0;
  const request = (command: Frame) => {
    const requestId = `r${++id}`;
    child.stdin.write(`${JSON.stringify({ ...command, id: requestId })}\n`);
    return next((frame) => frame.type === "response" && frame.id === requestId);
  };
  const loadout = async () => {
    const reported = next((frame) => String(frame.message).startsWith("loadout:"));
    await request({ type: "prompt", message: "/loadout" });
    const frame = await reported;
    return String(frame.message).slice("loadout:".length).split(",");
  };
  const close = () =>
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill();
    });
  return { next, request, loadout, close };
}

describe("installed Pi resume", () => {
  it("restores the session's recorded tool loadout instead of the default tools", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pie-resume-loadout-"));
    try {
      const created = startPi(dir, ["--provider", "loadout-test", "--model", "model"]);
      const initial = await created.loadout();
      assert.ok(initial.includes("bash"));
      await created.request({ type: "prompt", message: "/drop-bash" });
      // A run records the active loadout in the transcript.
      const ended = created.next((frame) => frame.type === "agent_end");
      await created.request({ type: "prompt", message: "hello" });
      await ended;
      const state = await created.request({ type: "get_state" });
      const sessionId = (state.data as { sessionId: string }).sessionId;
      await created.close();

      // Pie resumes by id without --tools, so Pi starts from its default tools.
      const resumed = startPi(dir, ["--session-id", sessionId]);
      const tools = await resumed.loadout();
      await resumed.close();
      assert.ok(tools.includes("read"));
      assert.equal(tools.includes("bash"), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
