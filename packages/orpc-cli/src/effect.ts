import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  CliUsageError,
  INPUT_KEY,
  callProcedure,
  inputFromValues,
  missingRequired,
  parseJson,
  readCliCommands,
  writeOutput,
  type CliAdapterOptions,
  type CliCommandSpec,
  type CliField,
} from "./metadata";

/** Effect CLI adapter. Compose the returned commands with `Command.withSubcommands`. */
export async function createEffectCli(
  options: CliAdapterOptions,
): Promise<ReadonlyArray<Command.Command.Any>> {
  const specs = await readCliCommands(options.router);
  return group(specs).map((node) => compile(node, options));
}

interface Node {
  name: string;
  children: Map<string, Node>;
  leaf?: CliCommandSpec;
}

function group(specs: readonly CliCommandSpec[]): readonly Node[] {
  const roots = new Map<string, Node>();
  for (const spec of specs) {
    let level = roots;
    for (const [index, name] of spec.path.entries()) {
      let node = level.get(name);
      if (node === undefined) {
        node = { name, children: new Map() };
        level.set(name, node);
      }
      if (index === spec.path.length - 1) node.leaf = spec;
      level = node.children;
    }
  }
  return [...roots.values()];
}

function compile(node: Node, options: CliAdapterOptions): Command.Command.Any {
  const children = [...node.children.values()].map((child) => compile(child, options));
  if (node.leaf !== undefined) return leaf(node.leaf, options);
  return Command.make(node.name).pipe(Command.withSubcommands(children));
}

function leaf(spec: CliCommandSpec, options: CliAdapterOptions): Command.Command.Any {
  const relaxRequired = spec.hasInput && !spec.fields.some((field) => field.flag === "input");
  const config: { [key: string]: Flag.Flag<unknown> } = {};
  for (const field of spec.fields) config[field.key] = fieldFlag(field, relaxRequired);
  if (relaxRequired) config[INPUT_KEY] = inputFlag(spec.jsonOnly);

  const name = spec.path.at(-1);
  if (name === undefined) throw new Error("cli() procedure is missing a router path");
  let command = Command.make(name, config, (parsed) =>
    Effect.tryPromise({
      try: () => runLeaf(spec, parsed, options),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  );
  if (spec.meta.description !== undefined) {
    command = command.pipe(Command.withDescription(spec.meta.description));
  }
  return command;
}

async function runLeaf(
  spec: CliCommandSpec,
  parsed: Readonly<Record<string, unknown>>,
  options: CliAdapterOptions,
): Promise<void> {
  const values = readParsed(parsed);
  const missing = missingRequired(values, spec.fields);
  if (missing !== undefined) throw new CliUsageError(`required option '${missing}' not specified`);
  const output = await callProcedure(
    spec.procedure,
    inputFromValues(values, spec),
    options.context,
  );
  await writeOutput(output);
}

function readParsed(parsed: Readonly<Record<string, unknown>>) {
  const values: { [key: string]: ReturnType<typeof parseJson> | undefined } = {};
  for (const [key, value] of Object.entries(parsed)) values[key] = unwrap(value);
  return values;
}

function unwrap(value: unknown): ReturnType<typeof parseJson> | undefined {
  if (Option.isOption(value)) return Option.isNone(value) ? undefined : unwrap(value.value);
  if (Array.isArray(value)) {
    const items: Array<ReturnType<typeof parseJson>> = [];
    for (const item of value) {
      const read = unwrap(item);
      if (read !== undefined) items.push(read);
    }
    return items;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "object") {
    const record: { [key: string]: ReturnType<typeof parseJson> } = {};
    for (const [key, nested] of Object.entries(value)) {
      const read = unwrap(nested);
      if (read !== undefined) record[key] = read;
    }
    return record;
  }
  return undefined;
}

function fieldFlag(field: CliField, relaxRequired: boolean): Flag.Flag<unknown> {
  let flag = baseFlag(field);
  if (field.description !== "") flag = flag.pipe(Flag.withDescription(field.description));
  if (!field.required || relaxRequired) flag = flag.pipe(Flag.optional);
  return flag;
}

function baseFlag(field: CliField): Flag.Flag<unknown> {
  if (field.kind === "boolean") return Flag.Boolean(field.flag);
  if (field.kind === "number") return Flag.Finite(field.flag);
  if (field.choices !== undefined) return Flag.Literals(field.flag, field.choices);
  if (field.kind === "array") return Flag.atLeast(itemFlag(field), 1);
  if (field.kind === "json") return jsonFlag(field.flag);
  return Flag.String(field.flag);
}

function itemFlag(field: CliField): Flag.Flag<unknown> {
  if (field.itemKind === "number") return Flag.Finite(field.flag);
  if (field.itemKind === "boolean") return Flag.Boolean(field.flag);
  return Flag.String(field.flag);
}

function jsonFlag(name: string): Flag.Flag<unknown> {
  return Flag.String(name).pipe(
    Flag.mapTryCatch(parseJson, (error) =>
      error instanceof Error ? error.message : "invalid JSON",
    ),
  );
}

function inputFlag(required: boolean): Flag.Flag<unknown> {
  const flag = jsonFlag("input").pipe(Flag.withDescription("Procedure input as JSON"));
  return required ? flag : flag.pipe(Flag.optional);
}
