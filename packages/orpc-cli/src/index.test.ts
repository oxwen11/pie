import "@orpc/experimental-effect/extensions/input-output";
import { oc } from "@orpc/contract";
import { implement, os } from "@orpc/server";
import { Command, CommanderError } from "commander";
import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createCommanderCli } from "./commander";
import { cli, completionScript, readCliCommands, renderOutput } from "./index";

const Create = Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) });
const Show = Schema.Struct({
  ref: Schema.Struct({ projectId: Schema.String, sessionId: Schema.String }),
});
const List = Schema.Struct({
  count: Schema.Int,
  tag: Schema.optional(Schema.Array(Schema.String)),
  archived: Schema.Boolean,
  mode: Schema.optional(Schema.Literals(["all", "open"])),
});
const Name = Schema.String.check(Schema.isMinLength(3));
const Worktree = Schema.Struct({
  branch: Schema.String,
  spec: Schema.Unknown,
});

async function run(program: Command, argv: readonly string[]) {
  const help: string[] = [];
  const write = (text: string) => {
    help.push(text);
  };
  const configure = (command: Command) => {
    command.configureOutput({ writeOut: write, writeErr: write });
    for (const child of command.commands) configure(child);
  };
  configure(program);
  const stdout: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  try {
    await program.parseAsync([...argv], { from: "user" });
    return { exitCode: 0, stdout: stdout.join(""), help: help.join("") };
  } catch (error) {
    if (error instanceof CommanderError) {
      return { exitCode: error.exitCode, stdout: stdout.join(""), help: help.join(""), error };
    }
    throw error;
  } finally {
    spy.mockRestore();
  }
}

describe("createCommanderCli", () => {
  it("registers only cli() procedures and maps options into call input", async () => {
    let created: unknown;
    let listed = false;
    const contract = {
      project: {
        create: oc.meta(cli({ description: "Register a project" })).input(Create),
        list: oc.input(Schema.Struct({ archived: Schema.optional(Schema.Boolean) })),
      },
    };
    const base = implement(contract);
    const program = await createCommanderCli({
      router: base.router({
        project: {
          create: base.project.create.handler(({ input }) => {
            created = input;
            return input;
          }),
          list: base.project.list.handler(() => {
            listed = true;
            return [];
          }),
        },
      }),
    });

    const help = await run(program, ["project", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.help).toContain("create");
    expect(help.help).toContain("Register a project");
    expect(help.help).not.toContain("list");

    const result = await run(program, ["project", "create", "--path", "/tmp/pie"]);
    expect(result.exitCode).toBe(0);
    expect(created).toEqual({ path: "/tmp/pie" });
    expect(result.stdout).toBe('{"path":"/tmp/pie"}\n');
    expect(listed).toBe(false);

    const unknown = await run(program, ["project", "list"]);
    expect(unknown.exitCode).not.toBe(0);
    expect(listed).toBe(false);
  });

  it("nests dotted options, coerces scalars, and repeats arrays", async () => {
    let shown: unknown;
    let listed: unknown;
    const contract = {
      session: {
        show: oc.meta(cli({ description: "Show" })).input(Show),
        list: oc.meta(cli()).input(List),
      },
    };
    const base = implement(contract);
    const program = await createCommanderCli({
      router: base.router({
        session: {
          show: base.session.show.handler(({ input }) => {
            shown = input;
            return input;
          }),
          list: base.session.list.handler(({ input }) => {
            listed = input;
            return input;
          }),
        },
      }),
    });

    await run(program, ["session", "show", "--ref.project-id", "p1", "--ref.session-id", "s1"]);
    expect(shown).toEqual({ ref: { projectId: "p1", sessionId: "s1" } });

    const listedResult = await run(program, [
      "session",
      "list",
      "--count",
      "2",
      "--tag",
      "a",
      "--tag",
      "b",
      "--archived",
      "--mode",
      "open",
    ]);
    expect(listedResult.exitCode).toBe(0);
    expect(listed).toEqual({ count: 2, tag: ["a", "b"], archived: true, mode: "open" });

    let negated: unknown;
    const again = implement({
      session: { list: oc.meta(cli({})).input(List) },
    });
    const negatedProgram = await createCommanderCli({
      router: again.router({
        session: {
          list: again.session.list.handler(({ input }) => {
            negated = input;
            return input;
          }),
        },
      }),
    });
    await run(negatedProgram, ["session", "list", "--count", "1", "--no-archived"]);
    expect(negated).toEqual({ count: 1, archived: false });
  });

  it("uses --input for the whole payload and for non-object schemas", async () => {
    let created: unknown;
    let named: unknown;
    let nameCalled = false;
    const contract = {
      project: {
        create: oc.meta(cli({})).input(Create),
        name: oc.meta(cli({})).input(Name),
      },
    };
    const base = implement(contract);
    const program = await createCommanderCli({
      router: base.router({
        project: {
          create: base.project.create.handler(({ input }) => {
            created = input;
            return input;
          }),
          name: base.project.name.handler(({ input }) => {
            nameCalled = true;
            named = input;
            return input;
          }),
        },
      }),
    });

    await run(program, ["project", "create", "--input", '{"path":"from-json"}']);
    expect(created).toEqual({ path: "from-json" });

    const mixed = await run(program, ["project", "create", "--input", "{}", "--path", "/tmp"]);
    expect(mixed.exitCode).not.toBe(0);
    expect(created).toEqual({ path: "from-json" });

    await run(program, ["project", "name", "--input", '"Ada"']);
    expect(named).toBe("Ada");

    nameCalled = false;
    const invalid = await run(program, ["project", "name", "--input", '"no"']);
    expect(invalid.exitCode).not.toBe(0);
    expect(nameCalled).toBe(false);
  });

  it("rejects missing required options, unknown options, and invalid JSON before the handler", async () => {
    let called = false;
    const contract = {
      project: { create: oc.meta(cli({})).input(Create) },
    };
    const base = implement(contract);
    const program = await createCommanderCli({
      router: base.router({
        project: {
          create: base.project.create.handler(() => {
            called = true;
            return {};
          }),
        },
      }),
    });

    const missing = await run(program, ["project", "create"]);
    const unknown = await run(program, ["project", "create", "--nope", "x"]);
    const positional = await run(program, ["project", "create", "positional"]);
    const empty = await run(program, ["project", "create", "--path", ""]);
    const badJson = await run(program, ["project", "create", "--input", "{"]);
    expect(missing.exitCode).not.toBe(0);
    expect(unknown.exitCode).not.toBe(0);
    expect(positional.exitCode).not.toBe(0);
    expect(empty.exitCode).not.toBe(0);
    expect(badJson.exitCode).not.toBe(0);
    expect(called).toBe(false);
  });

  it("accepts a JSON option for a non-flat field and keeps hand-written commands", async () => {
    let created: unknown;
    let started = false;
    const contract = {
      session: { create: oc.meta(cli({})).input(Worktree) },
    };
    const base = implement(contract);
    const program = await createCommanderCli({
      router: base.router({
        session: {
          create: base.session.create.handler(({ input }) => {
            created = input;
            return input;
          }),
        },
      }),
    });
    program
      .command("daemon")
      .command("start")
      .action(() => {
        started = true;
      });

    await run(program, ["session", "create", "--branch", "feat", "--spec", '{"base":"main"}']);
    expect(created).toEqual({ branch: "feat", spec: { base: "main" } });

    const daemon = await run(program, ["daemon", "start"]);
    expect(daemon.exitCode).toBe(0);
    expect(started).toBe(true);
  });

  it("unlazies nested routers before registering commands", async () => {
    const create = os.meta(cli()).handler(() => "loaded");
    const program = await createCommanderCli({
      router: {
        project: os.lazy(async () => ({ default: { create } })),
      },
    });

    const result = await run(program, ["project", "create"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"loaded"\n');
  });

  it("writes each event iterator value as a JSON line", async () => {
    const events = os.meta(cli()).handler(async function* () {
      yield { n: 1 };
      yield { n: 2 };
    });
    const program = await createCommanderCli({ router: { events } });

    const result = await run(program, ["events"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"n":1}\n{"n":2}\n');
  });

  it("parses integers, dates, bigints, records, aliases, and positionals", async () => {
    let received: unknown;
    const Input = Schema.Struct({
      count: Schema.Int,
      at: Schema.Date,
      n: Schema.BigInt,
      labels: Schema.Record(Schema.String, Schema.String),
      path: Schema.String,
    });
    const procedure = os
      .meta(cli({ alias: "go", positionals: ["path"], options: { labels: { hidden: true } } }))
      .input(Input)
      .handler(({ input }) => {
        received = input;
        return input;
      });
    const program = await createCommanderCli({ router: { run: procedure } });
    const help = await run(program, ["run", "--help"]);
    expect(help.help).toContain("go");
    expect(help.help).not.toContain("labels");

    const result = await run(program, [
      "go",
      "/tmp",
      "--count",
      "2",
      "--at",
      "2020-01-02T00:00:00.000Z",
      "--n",
      "12",
      "--labels",
      "foo=bar",
    ]);
    expect(result.exitCode).toBe(0);
    expect(received).toMatchObject({
      count: 2,
      n: 12n,
      labels: { foo: "bar" },
      path: "/tmp",
    });
    expect(received).toMatchObject({ at: new Date("2020-01-02T00:00:00.000Z") });

    const bad = await run(program, [
      "run",
      "/tmp",
      "--count",
      "2.5",
      "--at",
      "2020-01-02",
      "--n",
      "1",
    ]);
    expect(bad.exitCode).not.toBe(0);
    expect(completionScript("pie", await readCliCommands({ run: procedure }))).toContain("run");

    const finite = await createCommanderCli({
      router: {
        run: os
          .meta(cli())
          .input(Schema.Struct({ n: Schema.Number }))
          .handler(() => "no"),
      },
    });
    const infinite = await run(finite, ["run", "--n", "Infinity"]);
    expect(infinite.exitCode).not.toBe(0);

    const first = os.meta(cli()).handler(() => "a");
    const second = os.meta(cli()).handler(() => "b");
    await expect(
      createCommanderCli({ router: { listModels: first, "list-models": second } }),
    ).rejects.toThrow(/registered twice/);
  });

  it("renders object arrays as a table on a tty", () => {
    expect(renderOutput([{ name: "ada" }, { name: "bea" }], true)).toContain("ada");
    expect(renderOutput("hello", true)).toBe("hello\n");
    expect(renderOutput({ name: "ada" }, false)).toBe('{"name":"ada"}\n');
  });
});
