import os from "node:os";

import { Context, Effect } from "effect";

import { TerminalSpawnFailed } from "../errors";

export interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): () => void;
  onExit(callback: (exitCode: number) => void): () => void;
}

export type PtySpawnInput = {
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
};

export type PtySpawnOptions = PtySpawnInput & {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
};

export class Pty extends Context.Service<
  Pty,
  {
    readonly spawn: (input: PtySpawnInput) => Effect.Effect<PtyProcess, TerminalSpawnFailed>;
  }
>()("pie/terminal/Pty") {}

export const resolvePtySpawnOptions = (input: PtySpawnInput): PtySpawnOptions => {
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm-256color" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_PORT;

  return {
    ...input,
    env,
    command: os.platform() === "win32" ? "pwsh.exe" : process.env.SHELL?.trim() || "/bin/bash",
    args: os.platform() === "win32" ? ["-NoLogo"] : [],
  };
};

export const spawnPty = (
  input: PtySpawnInput,
): Effect.Effect<PtyProcess, TerminalSpawnFailed, Pty> =>
  Effect.flatMap(Pty, (pty) => pty.spawn(input));
