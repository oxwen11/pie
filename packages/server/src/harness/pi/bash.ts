import childProcess from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  type BashToolDetails,
  type ExtensionAPI,
  type ExtensionFactory,
  bashSchema,
  getShellConfig,
  killProcessTree,
  resolveSpawnContext,
  truncateTail,
  Type,
  waitForChildProcess,
} from "@earendil-works/pi-coding-agent";

const BLOCKED_EXACT = new Set(["PORT", "ELECTRON_RENDERER_PORT", "ELECTRON_RUN_AS_NODE"]);
const MAX_TIMEOUT_MS = 2_147_483_647;
const TAIL_BYTES = 100 * 1024;

/** Still running after this moves to the background. Not the kill timeout. */
const BACKGROUND_AFTER_MS = 60_000;
const livePids = new Set<number>();
const exitHook = { hooked: false };

function hookExit(): void {
  if (exitHook.hooked) return;
  exitHook.hooked = true;
  process.on("exit", () => {
    for (const pid of livePids) killProcessTree(pid);
  });
}

// Inherit-all minus product/host identity. An allowlist of PATH/HOME/LANG
// silently drops PSModulePath, DISPLAY, proxies, and toolchain vars.
export function filterPiBashEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const normalized = key.toUpperCase();
    if (
      normalized.startsWith("PIE_") ||
      normalized.startsWith("VITE_") ||
      BLOCKED_EXACT.has(normalized)
    ) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function bashLogPath(sessionId: string, jobId: string): string {
  return path.join(os.tmpdir(), "pie", safeSegment(sessionId), "bash", `${safeSegment(jobId)}.log`);
}

function safeSegment(value: string): string {
  const cleaned = value.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  return cleaned || "unknown";
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Invalid timeout: must be a finite number of seconds");
  }
  const timeoutMs = timeout * 1000;
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_MS / 1000} seconds`);
  }
  return timeoutMs;
}

function exitCodeOf(signalCode: NodeJS.Signals | null, code: number | null): number {
  if (code !== null) return code;
  return signalCode ? 128 + (os.constants.signals[signalCode] ?? 0) : 1;
}

function appendStatus(text: string, status: string): string {
  return `${text ? `${text}\n\n` : ""}${status}`;
}

function keepTail(text: string): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= TAIL_BYTES) return text;
  let start = bytes.length - TAIL_BYTES;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

function openLog(logPath: string): fs.WriteStream {
  const dir = path.dirname(logPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const log = fs.createWriteStream(logPath, { flags: "a", mode: 0o600 });
  log.on("error", () => undefined);
  return log;
}

function endLog(log: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    log.once("error", () => resolve());
    log.end(() => resolve());
  });
}

function flushLog(log: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    log.once("error", done);
    if (!log.write(Buffer.alloc(0), done)) log.once("drain", done);
  });
}

function unlinkQuiet(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already gone
  }
}

function renderTail(raw: string, logPath: string) {
  const truncation = truncateTail(raw);
  if (!truncation.truncated) return { text: truncation.content };
  return {
    text: `${truncation.content}\n\n[Truncated. Full output: ${logPath}]`,
    details: { truncation, fullOutputPath: logPath },
  };
}

export interface PieBashResult {
  text: string;
  details?: BashToolDetails;
}

/** Same idle grace as Pi's waitForChildProcess. A descendant can hold the pipe after exit. */
const PIPE_IDLE_MS = 100;

declare const Bun: {
  spawn(options: {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
    stdin: "ignore" | "pipe";
    stdout: "pipe";
    stderr: "pipe";
    detached?: boolean;
  }): {
    pid: number;
    signalCode: NodeJS.Signals | null;
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    stdin: {
      write(data: string): number | Promise<number>;
      end(): number | Promise<number>;
    } | null;
  };
};

interface ShellProc {
  pid: number;
  signalCode: () => NodeJS.Signals | null;
  onData: (handler: (data: Uint8Array) => void) => void;
  done: Promise<number | null>;
  writeStdin?: (command: string) => void;
}

function stringEnv(env: NodeJS.ProcessEnv) {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function waitBun(
  proc: ReturnType<typeof Bun.spawn>,
  onChunk: (data: Uint8Array) => void,
): Promise<number | null> {
  return new Promise((resolve) => {
    let exitCode: number | null = null;
    let exited = false;
    let open = 2;
    let idle: NodeJS.Timeout | undefined;
    let settled = false;
    const readers = [proc.stdout.getReader(), proc.stderr.getReader()];
    const finish = () => {
      if (settled) return;
      settled = true;
      if (idle) clearTimeout(idle);
      for (const reader of readers) void reader.cancel().catch(() => undefined);
      resolve(exitCode);
    };
    const arm = () => {
      if (!exited || settled) return;
      if (open === 0) return finish();
      if (idle) clearTimeout(idle);
      idle = setTimeout(finish, PIPE_IDLE_MS);
    };
    const pump = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> => {
      const next = await reader.read();
      if (settled) return;
      if (next.done) {
        open -= 1;
        arm();
        return;
      }
      onChunk(next.value);
      arm();
      return pump(reader);
    };
    for (const reader of readers) void pump(reader).catch(() => undefined);
    void proc.exited.then((code) => {
      exitCode = code;
      exited = true;
      arm();
      return undefined;
    });
  });
}

function spawnBun(
  shell: string,
  args: string[],
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  fromStdin: boolean,
): ShellProc {
  const proc = Bun.spawn({
    cmd: fromStdin ? [shell, ...args] : [shell, ...args, command],
    cwd,
    env: stringEnv(env),
    stdin: fromStdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  });
  const pending: Uint8Array[] = [];
  let onChunk: ((data: Uint8Array) => void) | undefined;
  const emit = (data: Uint8Array) => {
    if (onChunk) onChunk(data);
    else pending.push(data);
  };
  return {
    pid: proc.pid,
    signalCode: () => proc.signalCode,
    onData: (handler) => {
      onChunk = handler;
      for (const chunk of pending.splice(0)) handler(chunk);
    },
    done: waitBun(proc, emit),
    writeStdin: fromStdin
      ? (text) => {
          void proc.stdin?.write(text);
          void proc.stdin?.end();
        }
      : undefined,
  };
}

function spawnNode(
  shell: string,
  args: string[],
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  fromStdin: boolean,
): ShellProc {
  const child = childProcess.spawn(shell, fromStdin ? args : [...args, command], {
    cwd,
    detached: process.platform !== "win32",
    env,
    stdio: [fromStdin ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (!child.pid) throw new Error("Failed to start command");
  return {
    pid: child.pid,
    signalCode: () => child.signalCode,
    onData: (handler) => {
      child.stdout?.on("data", handler);
      child.stderr?.on("data", handler);
    },
    done: waitForChildProcess(child),
    writeStdin: fromStdin
      ? (text) => {
          child.stdin?.on("error", () => undefined);
          child.stdin?.end(text);
        }
      : undefined,
  };
}

function spawnShell(
  shell: string,
  args: string[],
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  fromStdin: boolean,
): ShellProc {
  return process.versions.bun
    ? spawnBun(shell, args, command, cwd, env, fromStdin)
    : spawnNode(shell, args, command, cwd, env, fromStdin);
}

export async function executePieBash(input: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutSeconds?: number;
  runInBackground?: boolean;
  yieldMs?: number;
  signal?: AbortSignal;
  logPath: (pid: number) => string;
  onBackgroundExit?: (message: string) => void;
}): Promise<PieBashResult> {
  if (input.signal?.aborted) throw new Error("Command aborted");
  const timeoutMs = resolveTimeoutMs(input.timeoutSeconds);
  try {
    await fsPromises.access(input.cwd, fs.constants.F_OK);
  } catch {
    throw new Error(
      `Working directory does not exist: ${input.cwd}\nCannot execute bash commands.`,
    );
  }

  const shellConfig = getShellConfig();
  const fromStdin = shellConfig.commandTransport === "stdin";
  const shell = spawnShell(
    shellConfig.shell,
    shellConfig.args,
    input.command,
    input.cwd,
    input.env,
    fromStdin,
  );
  shell.writeStdin?.(input.command);
  const pid = shell.pid;
  livePids.add(pid);

  const logPath = input.logPath(pid);
  let log: fs.WriteStream;
  try {
    log = openLog(logPath);
  } catch (error) {
    killProcessTree(pid);
    livePids.delete(pid);
    throw error;
  }

  const decoder = new TextDecoder();
  let tail = "";
  let captureTail = true;
  const onData = (data: Buffer) => {
    log.write(data);
    if (!captureTail) return;
    tail = keepTail(tail + decoder.decode(data, { stream: true }));
  };
  shell.onData(onData);

  let killReason: "abort" | "timeout" | undefined;
  const kill = (reason: "abort" | "timeout") => {
    if (killReason) return;
    killReason = reason;
    killProcessTree(pid);
  };
  let timeoutHandle: NodeJS.Timeout | undefined;
  if (timeoutMs !== undefined) timeoutHandle = setTimeout(() => kill("timeout"), timeoutMs);
  const onAbort = () => kill("abort");
  if (input.signal) {
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) onAbort();
  }

  const settled = { finished: false };
  const exited = shell.done.then(
    (code) => {
      settled.finished = true;
      return { ok: true as const, code };
    },
    (error: unknown) => {
      settled.finished = true;
      return { ok: false as const, error };
    },
  );
  const yieldMs = input.runInBackground ? 0 : (input.yieldMs ?? BACKGROUND_AFTER_MS);
  let yieldTimer: NodeJS.Timeout | undefined;
  const yielded = new Promise<"yield">((resolve) => {
    yieldTimer = setTimeout(() => resolve("yield"), yieldMs);
  });
  const winner = await Promise.race([exited.then(() => "exit" as const), yielded]);

  const flushTail = () => {
    captureTail = false;
    tail = keepTail(tail + decoder.decode());
  };
  const finish = async (): Promise<PieBashResult> => {
    if (yieldTimer) clearTimeout(yieldTimer);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", onAbort);
    const result = await exited;
    flushTail();
    await endLog(log);
    livePids.delete(pid);
    const rendered = renderTail(tail, logPath);
    const empty = killReason || (result.ok && result.code !== 0) ? "" : "(no output)";
    const text = rendered.text || empty;
    if (!rendered.details) unlinkQuiet(logPath);
    if (killReason === "abort") throw new Error(appendStatus(text, "Command aborted"));
    if (killReason === "timeout") {
      throw new Error(
        appendStatus(text, `Command timed out after ${input.timeoutSeconds} seconds`),
      );
    }
    if (!result.ok) throw result.error;
    const code = exitCodeOf(shell.signalCode(), result.code);
    if (code !== 0) throw new Error(appendStatus(text, `Command exited with code ${code}`));
    return { text, details: rendered.details };
  };

  if (winner === "exit" || settled.finished || killReason) return finish();

  input.signal?.removeEventListener("abort", onAbort);
  flushTail();
  const preview = renderTail(tail, logPath);
  await flushLog(log);
  if (settled.finished || killReason) return finish();
  void exited
    .then(async (result) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      await endLog(log);
      livePids.delete(pid);
      const status =
        killReason === "timeout"
          ? `timed out after ${input.timeoutSeconds} seconds`
          : result.ok
            ? `finished with exit code ${exitCodeOf(shell.signalCode(), result.code)}`
            : `failed to start: ${result.error instanceof Error ? result.error.message : String(result.error)}`;
      const message = `Background command ${pid} ${status}. Output: ${logPath}`;
      input.onBackgroundExit?.(message);
      return message;
    })
    .catch(() => undefined);

  const head = preview.text ? `${preview.text}\n\n` : "";
  return {
    text: `${head}Command running in background with pid ${pid}. Output is being written to: ${logPath}. Read that file for later output. Stop it with \`kill -- -${pid}\`.`,
    details: preview.details ?? { fullOutputPath: logPath },
  };
}

const pieBashSchema = Type.Object({
  ...bashSchema.properties,
  run_in_background: Type.Optional(
    Type.Boolean({
      description: "Return as soon as the command is running, with a pid and log path.",
    }),
  ),
});

export function piBashExtension(cwd: string): ExtensionFactory {
  hookExit();
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "bash",
      label: "bash",
      description: `Execute a bash command in the current working directory. Returns stdout and stderr. If the command is still running after ${BACKGROUND_AFTER_MS / 1000} seconds, it moves to the background and this call returns its pid and log path. Set run_in_background to return immediately. Read the log file for later output. A timeout in seconds kills the command instead of backgrounding it.`,
      promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
      promptGuidelines: [
        "You can inspect PI_* environment variables for current model and session details.",
        `Commands still running after ${BACKGROUND_AFTER_MS / 1000} seconds move to the background and return a pid and log path. Read that file for later output. Stop a background command with \`kill -- -<pid>\`.`,
      ],
      parameters: pieBashSchema,
      constrainedSampling: { type: "json_schema", strict: "prefer" },
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const spawned = resolveSpawnContext(params.command, ctx.cwd || cwd, undefined, true, ctx);
        const result = await executePieBash({
          command: spawned.command,
          cwd: spawned.cwd,
          env: filterPiBashEnv(spawned.env),
          timeoutSeconds: params.timeout,
          runInBackground: params.run_in_background,
          signal,
          logPath: (pid) =>
            bashLogPath(ctx.sessionManager.getSessionId() ?? "unknown", String(pid)),
          onBackgroundExit: (message) => {
            try {
              pi.sendUserMessage(message, { deliverAs: "followUp" });
            } catch {
              // session already closed
            }
          },
        });
        return {
          content: [{ type: "text" as const, text: result.text }],
          details: result.details,
        };
      },
    });
  };
}
