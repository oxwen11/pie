import { Effect, Layer } from "effect";

import { TerminalSpawnFailed } from "../errors";
import { Pty, resolvePtySpawnOptions, type PtyProcess, type PtySpawnInput } from "./pty";

const spawn = (input: PtySpawnInput): Effect.Effect<PtyProcess, TerminalSpawnFailed> =>
  Effect.tryPromise({
    try: async () => {
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
    },
    catch: (cause) => new TerminalSpawnFailed({ cwd: input.cwd, cause }),
  });

export const NodePtyLayer: Layer.Layer<Pty> = Layer.succeed(Pty, Pty.of({ spawn }));
