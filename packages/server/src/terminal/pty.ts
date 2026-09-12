/**
 * node-pty has no Effect equivalent — same exemption as daemon spawnDetached.
 * This module is the only place that imports it.
 */
import os from "node:os";

import { Effect } from "effect";

import { TerminalSpawnFailed } from "../errors";

export interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): () => void;
  onExit(callback: (exitCode: number) => void): () => void;
}

export const spawnPty = (input: {
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
}): Effect.Effect<PtyProcess, TerminalSpawnFailed> =>
  Effect.tryPromise({
    try: async () => {
      const nodePty = await import("node-pty");
      const env: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm-256color" };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.ELECTRON_RENDERER_PORT;
      const shell =
        os.platform() === "win32"
          ? { command: "pwsh.exe", args: ["-NoLogo"] }
          : { command: process.env.SHELL?.trim() || "/bin/bash", args: [] };
      const spawned = nodePty.spawn(shell.command, shell.args, {
        cwd: input.cwd,
        cols: input.cols,
        rows: input.rows,
        env,
        name: "xterm-256color",
      });
      return {
        write: (data: string) => spawned.write(data),
        resize: (cols: number, rows: number) => spawned.resize(cols, rows),
        kill: () => spawned.kill(),
        onData: (callback: (data: string) => void) => {
          const disposable = spawned.onData(callback);
          return () => disposable.dispose();
        },
        onExit: (callback: (exitCode: number) => void) => {
          const disposable = spawned.onExit((event) => {
            callback(event.exitCode);
          });
          return () => disposable.dispose();
        },
      };
    },
    catch: (cause) => new TerminalSpawnFailed({ cwd: input.cwd, cause }),
  });
