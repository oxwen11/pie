import { Effect, Layer } from "effect";

import { TerminalSpawnFailed } from "../errors";
import { Pty, resolvePtySpawnOptions, type PtyProcess, type PtySpawnInput } from "./pty";

type BunTerminal = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
};

type BunSubprocess = {
  readonly terminal: BunTerminal | undefined;
  readonly exited: Promise<number>;
  kill(): void;
};

type BunRuntime = {
  spawn(
    command: string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      terminal: {
        cols: number;
        rows: number;
        data(terminal: BunTerminal, data: Uint8Array): void;
      };
    },
  ): BunSubprocess;
};

const spawn = (input: PtySpawnInput): Effect.Effect<PtyProcess, TerminalSpawnFailed> =>
  Effect.try({
    try: () => {
      const bun = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
      if (bun === undefined) throw new Error("Bun runtime is unavailable");

      const options = resolvePtySpawnOptions(input);
      const decoder = new TextDecoder();
      const dataListeners = new Set<(data: string) => void>();
      const exitListeners = new Set<(exitCode: number) => void>();
      let earlyOutput = "";
      let exitCode: number | undefined;

      const emitData = (data: string): void => {
        if (dataListeners.size === 0) {
          earlyOutput += data;
          return;
        }
        for (const listener of dataListeners) listener(data);
      };

      const spawned = bun.spawn([options.command, ...options.args], {
        cwd: options.cwd,
        env: options.env,
        terminal: {
          cols: options.cols,
          rows: options.rows,
          data: (_terminal, data) => emitData(decoder.decode(data, { stream: true })),
        },
      });
      const terminal = spawned.terminal;
      if (terminal === undefined) throw new Error("Bun did not create a terminal");

      let terminalClosed = false;
      const closeTerminal = (): void => {
        if (terminalClosed) return;
        terminalClosed = true;
        terminal.close();
      };

      void spawned.exited.then((code) => {
        emitData(decoder.decode());
        exitCode = code;
        closeTerminal();
        for (const listener of exitListeners) listener(code);
        exitListeners.clear();
        return undefined;
      });

      return {
        write: (data) => terminal.write(data),
        resize: (cols, rows) => terminal.resize(cols, rows),
        kill: () => {
          closeTerminal();
          spawned.kill();
        },
        onData: (callback) => {
          dataListeners.add(callback);
          if (earlyOutput.length > 0) {
            const data = earlyOutput;
            earlyOutput = "";
            callback(data);
          }
          return () => dataListeners.delete(callback);
        },
        onExit: (callback) => {
          if (exitCode !== undefined) callback(exitCode);
          else exitListeners.add(callback);
          return () => exitListeners.delete(callback);
        },
      };
    },
    catch: (cause) => new TerminalSpawnFailed({ cwd: input.cwd, cause }),
  });

export const BunPtyLayer: Layer.Layer<Pty> = Layer.succeed(Pty, Pty.of({ spawn }));
