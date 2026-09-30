import { Effect, Layer } from "effect";

import { TerminalSpawnFailed } from "../errors";
import { Pty, resolvePtySpawnOptions, type PtyProcess, type PtySpawnInput } from "./pty";

// node-pty opens a tty.ReadStream on the master fd. Bun never emits "data"
// on that stream: the shell starts, then every byte is dropped. Bun.Terminal
// is the PTY in a Bun process. Node and Electron keep node-pty.
type BunTerminal = {
  write(data: string): number;
  resize(cols: number, rows: number): void;
  close(): void;
};

type BunRuntime = {
  readonly Terminal: new (options: {
    cols?: number;
    rows?: number;
    name?: string;
    data?: (terminal: BunTerminal, chunk: Uint8Array | string) => void;
  }) => BunTerminal;
  spawn(
    command: readonly string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      terminal: BunTerminal;
    },
  ): {
    readonly exited: Promise<number>;
    kill(signal?: string): void;
  };
};

const isBunRuntime = (value: unknown): value is BunRuntime => {
  if (typeof value !== "object" || value === null) return false;
  if (!("Terminal" in value) || !("spawn" in value)) return false;
  return typeof value.Terminal === "function" && typeof value.spawn === "function";
};

const bunRuntime = (): BunRuntime | undefined => {
  if (process.platform === "win32") return undefined;
  const host: unknown = globalThis;
  if (typeof host !== "object" || host === null || !("Bun" in host)) return undefined;
  return isBunRuntime(host.Bun) ? host.Bun : undefined;
};

const stringEnv = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

const spawnBunPty = (bun: BunRuntime, input: PtySpawnInput): PtyProcess => {
  const options = resolvePtySpawnOptions(input);
  const decoder = new TextDecoder();
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(exitCode: number) => void>();
  let pending = "";
  let exitCode: number | undefined;

  const emitData = (text: string): void => {
    if (text.length === 0) return;
    if (dataListeners.size === 0) {
      pending += text;
      return;
    }
    for (const listener of dataListeners) listener(text);
  };

  const terminal = new bun.Terminal({
    cols: options.cols,
    rows: options.rows,
    name: "xterm-256color",
    data(_terminal, chunk) {
      emitData(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    },
  });

  const proc = bun.spawn([options.command, ...options.args], {
    cwd: options.cwd,
    env: stringEnv(options.env),
    terminal,
  });

  const finish = (code: number): void => {
    if (exitCode !== undefined) return;
    exitCode = code;
    try {
      terminal.close();
    } catch {
      // The terminal is already closed when the caller killed the shell.
    }
    for (const listener of exitListeners) listener(code);
  };

  void proc.exited.then(finish, () => finish(1));

  return {
    write: (data) => {
      terminal.write(data);
    },
    resize: (cols, rows) => {
      terminal.resize(cols, rows);
    },
    kill: () => {
      try {
        proc.kill("SIGHUP");
      } catch {
        // The shell has already exited.
      }
    },
    onData: (callback) => {
      dataListeners.add(callback);
      if (pending.length > 0) {
        const buffered = pending;
        pending = "";
        callback(buffered);
      }
      return () => {
        dataListeners.delete(callback);
      };
    },
    onExit: (callback) => {
      if (exitCode !== undefined) callback(exitCode);
      exitListeners.add(callback);
      return () => {
        exitListeners.delete(callback);
      };
    },
  };
};

const spawnNodePty = async (input: PtySpawnInput): Promise<PtyProcess> => {
  const options = resolvePtySpawnOptions(input);
  const nodePty = await import("node-pty");
  const spawned = nodePty.spawn(options.command, [...options.args], {
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    env: options.env,
    name: "xterm-256color",
  });

  return {
    write: (data) => spawned.write(data),
    resize: (cols, rows) => spawned.resize(cols, rows),
    kill: () => spawned.kill(),
    onData: (callback) => {
      const disposable = spawned.onData(callback);
      return () => disposable.dispose();
    },
    onExit: (callback) => {
      const disposable = spawned.onExit((event) => callback(event.exitCode));
      return () => disposable.dispose();
    },
  };
};

const spawn = (input: PtySpawnInput): Effect.Effect<PtyProcess, TerminalSpawnFailed> =>
  Effect.tryPromise({
    try: async () => {
      const bun = bunRuntime();
      if (bun) return spawnBunPty(bun, input);
      return spawnNodePty(input);
    },
    catch: (cause) => new TerminalSpawnFailed({ cwd: input.cwd, cause }),
  });

export const NodePtyLayer: Layer.Layer<Pty> = Layer.succeed(Pty, Pty.of({ spawn }));
