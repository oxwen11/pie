import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { describe, expect, it } from "vitest";

const ptyModule = url.pathToFileURL(
  path.join(import.meta.dirname, "../../src/terminal/pty.ts"),
).href;
const bunPtyModule = url.pathToFileURL(
  path.join(import.meta.dirname, "../../src/terminal/pty-bun.ts"),
).href;

const SCRIPT = `
import { Effect } from "effect";
import { spawnPty } from ${JSON.stringify(ptyModule)};
import { BunPtyLayer } from ${JSON.stringify(bunPtyModule)};

const until = async (label, predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(50);
  }
  throw new Error(label);
};
const withTimeout = async (promise, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const pty = await Effect.runPromise(
  spawnPty({ cwd: process.cwd(), cols: 80, rows: 24 }).pipe(Effect.provide(BunPtyLayer)),
);
await Bun.sleep(300);
pty.write("printf early-output\\n");
await Bun.sleep(150);
let output = "";
const exited = new Promise((resolve) => pty.onExit(resolve));
pty.onData((data) => { output += data; });
const early = output.includes("early-output");

pty.resize(100, 40);
pty.write("stty size\\n");
await until("resize output missing", () => output.includes("40 100"));
const beforeHighOutput = output.length;
pty.write("yes x | head -c 262144\\n");
await until("high output missing", () => output.length - beforeHighOutput > 200_000);
pty.write("sleep 10\\n");
await Bun.sleep(150);
pty.write("\\x03");
await Bun.sleep(100);
pty.write("exit 23\\n");
const exitCode = await withTimeout(exited, "PTY did not exit after Ctrl+C");

const killedPty = await Effect.runPromise(
  spawnPty({ cwd: process.cwd(), cols: 80, rows: 24 }).pipe(Effect.provide(BunPtyLayer)),
);
const killed = new Promise((resolve) => killedPty.onExit(resolve));
await Bun.sleep(300);
killedPty.write("sleep 10\\n");
await Bun.sleep(100);
killedPty.kill();
const killedExitCode = await withTimeout(killed, "killed PTY did not exit");

console.log(JSON.stringify({ early, exitCode, killedExitCode }));
if (!early || exitCode !== 23 || killedExitCode === 0) process.exit(1);
`;

describe.skipIf(process.platform === "win32")("Bun PTY", () => {
  it("buffers early output and supports resize, interruption, real exits, kill, and sustained output", () => {
    const directory = fs.mkdtempSync(path.join(import.meta.dirname, ".pty-bun-"));
    const script = path.join(directory, "check.ts");
    fs.writeFileSync(script, SCRIPT);
    try {
      const run = childProcess.spawnSync(
        process.env.PIE_BUN?.trim() ?? "bun",
        ["--no-install", script],
        { cwd: path.join(import.meta.dirname, "../.."), encoding: "utf8", timeout: 20_000 },
      );
      if (run.status !== 0) throw new Error(`${run.stdout}\n${run.stderr}`);
      const result = JSON.parse(run.stdout.trim()) as {
        early: boolean;
        exitCode: number;
        killedExitCode: number;
      };
      expect(result).toMatchObject({ early: true, exitCode: 23 });
      expect(result.killedExitCode).not.toBe(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
