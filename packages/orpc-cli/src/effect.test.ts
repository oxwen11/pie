import "@orpc/experimental-effect/extensions/input-output";
import { oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import { Effect, FileSystem, Layer, Path, Schema, Stdio, Terminal } from "effect";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect, it, vi } from "vitest";

import { cli, createEffectCli } from "./index";

const Create = Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) });
const Show = Schema.Struct({
  ref: Schema.Struct({ projectId: Schema.String, sessionId: Schema.String }),
});

const layer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("unused")),
  ),
);

async function run(command: Command.Command.Any, argv: readonly string[]) {
  const stdout: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  try {
    await Effect.runPromise(
      Command.runWith(command, { version: "0.0.0", renderErrors: false })(argv).pipe(
        Effect.provide(layer),
      ) as Effect.Effect<void, unknown>,
    );
    return { stdout: stdout.join("") };
  } finally {
    spy.mockRestore();
  }
}

describe("createEffectCli", () => {
  it("calls an opted-in procedure from flags and keeps sibling commands", async () => {
    let created: unknown;
    let started = false;
    const contract = {
      project: {
        create: oc.meta(cli({ description: "Register a project" })).input(Create),
        list: oc.input(Schema.Struct({})),
      },
    };
    const base = implement(contract);
    const daemon = Command.make("daemon", {}, () =>
      Effect.sync(() => {
        started = true;
      }),
    );
    const command = Command.make("pie").pipe(
      Command.withSubcommands([
        ...createEffectCli({
          router: base.router({
            project: {
              create: base.project.create.handler(({ input }) => {
                created = input;
                return input;
              }),
              list: base.project.list.handler(() => []),
            },
          }),
        }),
        daemon,
      ]),
    );

    const result = await run(command, ["project", "create", "--path", "/tmp/pie"]);
    expect(created).toEqual({ path: "/tmp/pie" });
    expect(result.stdout).toBe('{"path":"/tmp/pie"}\n');

    await run(command, ["daemon"]);
    expect(started).toBe(true);
  });

  it("nests dotted flags", async () => {
    let shown: unknown;
    const contract = { session: { show: oc.meta(cli({})).input(Show) } };
    const base = implement(contract);
    const command = Command.make("pie").pipe(
      Command.withSubcommands(
        createEffectCli({
          router: base.router({
            session: {
              show: base.session.show.handler(({ input }) => {
                shown = input;
                return input;
              }),
            },
          }),
        }),
      ),
    );

    await run(command, ["session", "show", "--ref", '{"projectId":"p1","sessionId":"s1"}']);
    expect(shown).toEqual({ ref: { projectId: "p1", sessionId: "s1" } });
  });
});
