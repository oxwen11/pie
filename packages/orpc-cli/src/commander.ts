import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

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

export interface CommanderCliOptions extends CliAdapterOptions {
  name?: string;
  description?: string;
  version?: string;
  /** Register onto this program. An existing command with the same path throws. */
  program?: Command;
}

/**
 * Commander adapter. Does not parse argv and does not `process.exit`
 * (`exitOverride`). `--help` and usage errors throw `CommanderError`.
 * Add non-oRPC commands on the returned program before `parseAsync`.
 */
export function createCommanderCli(options: CommanderCliOptions): Command {
  const program = options.program ?? new Command();
  program.exitOverride();
  program.showHelpAfterError();
  program.showSuggestionAfterError();
  if (options.program === undefined) {
    if (options.name !== undefined) program.name(options.name);
    if (options.description !== undefined) program.description(options.description);
    if (options.version !== undefined) program.version(options.version);
  }

  for (const spec of readCliCommands(options.router, options.toJsonSchema)) {
    register(program, spec, options);
  }
  return program;
}

function register(program: Command, spec: CliCommandSpec, options: CommanderCliOptions): void {
  const leafName = spec.path.at(-1);
  if (leafName === undefined) return;
  const parent = ensureParent(program, spec.path.slice(0, -1));
  if (
    parent.commands.some(
      (command) => command.name() === leafName || command.aliases().includes(leafName),
    )
  ) {
    throw new Error(`CLI command "${spec.path.join(" ")}" conflicts with an existing command`);
  }

  const leaf = parent.command(leafName);
  leaf.showHelpAfterError();
  if (spec.meta.description !== undefined) leaf.description(spec.meta.description);
  if (spec.meta.alias !== undefined) leaf.alias(spec.meta.alias);

  const claimedInput = spec.fields.some((field) => field.flag === "input");
  for (const field of spec.fields) addFieldOption(leaf, field);
  if (spec.hasInput && !claimedInput) {
    const inputOption = new FieldOption("--input <json>", "Procedure input as JSON", INPUT_KEY);
    inputOption.argParser((value: string) => {
      try {
        return parseJson(value);
      } catch (error) {
        throw new InvalidArgumentError(error instanceof Error ? error.message : "invalid JSON");
      }
    });
    if (spec.jsonOnly) inputOption.makeOptionMandatory(true);
    leaf.addOption(inputOption);
  }

  leaf.action(async () => {
    const values = leaf.opts<Record<string, JsonValue | undefined>>();
    const missing = missingRequired(values, spec.fields);
    if (missing !== undefined) {
      throw new CommanderError(
        1,
        "orpc-cli.required",
        `required option '${missing}' not specified`,
      );
    }
    try {
      const output = await callProcedure(
        spec.procedure,
        inputFromValues(values, spec),
        options.context,
      );
      writeOutput(output);
    } catch (error) {
      if (error instanceof CommanderError) throw error;
      if (error instanceof CliUsageError) {
        throw new CommanderError(1, "orpc-cli.input", error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new CommanderError(1, "orpc-cli.call", message);
    }
  });
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

function ensureParent(program: Command, names: readonly string[]): Command {
  let current = program;
  for (const name of names) {
    const existing = current.commands.find((command) => command.name() === name);
    if (existing !== undefined) {
      current = existing;
      continue;
    }
    const created = current.command(name);
    created.showHelpAfterError();
    current = created;
  }
  return current;
}

function addFieldOption(command: Command, field: CliField): void {
  const description = field.required ? appendRequired(field.description) : field.description;
  const option = new FieldOption(optionFlags(field), description, field.key);
  if (field.hidden === true) option.hideHelp();
  if (field.kind === "array") {
    const items = field.schema.items ?? {};
    option.argParser((value: string, previous: JsonValue[] | undefined) => [
      ...(previous ?? []),
      coerce(items, value),
    ]);
  } else if (field.kind === "number" || field.kind === "json") {
    option.argParser((value: string) => coerce(field.schema, value));
  }
  if (field.choices !== undefined) option.choices([...field.choices]);
  command.addOption(option);
  if (field.kind === "boolean") {
    const negation = new FieldOption(`--no-${field.flag}`, `Negate --${field.flag}`, field.key);
    if (field.hidden === true) negation.hideHelp();
    command.addOption(negation);
  }
}

function appendRequired(description: string): string {
  return description === "" ? "(required)" : `${description} (required)`;
}

function optionFlags(field: CliField): string {
  const long = `--${field.flag}`;
  const token =
    field.kind === "boolean"
      ? ""
      : field.kind === "number"
        ? " <number>"
        : field.kind === "json"
          ? " <json>"
          : " <value>";
  const body = `${long}${token}`;
  if (field.alias === undefined) return body;
  const short = field.alias.length === 1 ? `-${field.alias}` : `--${field.alias}`;
  return `${short}, ${body}`;
}

function coerce(schema: CliField["schema"], value: string): JsonValue {
  if (schema.type === "number" || schema.type === "integer") {
    if (value.trim() === "" || Number.isNaN(Number(value))) {
      throw new InvalidArgumentError(`expected a number, got "${value}"`);
    }
    return Number(value);
  }
  if (schema.type === "object" || schema.type === "array") {
    try {
      return parseJson(value);
    } catch (error) {
      throw new InvalidArgumentError(error instanceof Error ? error.message : "invalid JSON");
    }
  }
  return value;
}

class FieldOption extends Option {
  readonly #key: string;

  constructor(flags: string, description: string, key: string) {
    super(flags, description);
    this.#key = key;
  }

  override attributeName(): string {
    return this.#key;
  }
}
