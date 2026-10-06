import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

import {
  CliUsageError,
  INPUT_KEY,
  callProcedure,
  coercePrimitive,
  inputFromValues,
  missingRequired,
  parseJson,
  parseRecordEntry,
  promptMissing,
  readCliCommands,
  writeOutput,
  type CliAdapterOptions,
  type CliCommandSpec,
  type CliField,
  type CliValue,
} from "./metadata";

/**
 * Commander adapter. Does not parse argv and does not `process.exit`
 * (`exitOverride`). `--help` and usage errors throw `CommanderError`.
 * Add non-oRPC commands on the returned program before `parseAsync`.
 */
export async function createCommanderCli(options: CliAdapterOptions): Promise<Command> {
  const program = new Command();
  program.exitOverride();
  program.showHelpAfterError();
  program.showSuggestionAfterError();
  for (const spec of await readCliCommands(options.router)) {
    register(program, spec, options);
  }
  return program;
}

function register(program: Command, spec: CliCommandSpec, options: CliAdapterOptions): void {
  const leafName = spec.path.at(-1);
  if (leafName === undefined) return;
  const parent = ensureParent(program, spec.path.slice(0, -1));
  const leaf = parent.command(leafName);
  leaf.showHelpAfterError();
  if (spec.meta.description !== undefined) leaf.description(spec.meta.description);
  if (spec.meta.alias !== undefined) leaf.alias(spec.meta.alias);
  const claimedInput = spec.fields.some((field) => field.flag === "input");
  for (const field of spec.fields) {
    if (field.positional === true) addArgument(leaf, field);
    else addFieldOption(leaf, field);
  }
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
    const values = leaf.opts<Record<string, CliValue | undefined>>();
    let positional = 0;
    for (const field of spec.fields) {
      if (!field.positional) continue;
      const value: unknown = leaf.processedArgs[positional];
      positional += 1;
      if (isCliValue(value)) values[field.key] = value;
    }
    await promptMissing(spec.fields, values, options.prompt);
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
      await writeOutput(output, options.tables);
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

function addArgument(command: Command, field: CliField): void {
  const name = field.required ? `<${field.flag}>` : `[${field.flag}]`;
  command.argument(name, field.description, (value: string) => {
    try {
      return coercePrimitive(field.kind, value);
    } catch (error) {
      throw new InvalidArgumentError(error instanceof Error ? error.message : "invalid value");
    }
  });
}

function addFieldOption(command: Command, field: CliField): void {
  const description = field.required ? appendRequired(field.description) : field.description;
  const option = new FieldOption(optionFlags(field), description, field.key);
  if (field.hidden === true) option.hideHelp();
  if (field.kind !== "boolean") {
    option.argParser((value: string, previous: CliValue | undefined) =>
      parseOption(field, value, previous),
    );
  }
  if (field.choices !== undefined) option.choices([...field.choices]);
  command.addOption(option);
  if (field.kind === "boolean") {
    command.addOption(new FieldOption(`--no-${field.flag}`, `Negate --${field.flag}`, field.key));
  }
}

function isCliValue(value: unknown): value is CliValue {
  return value !== undefined;
}

function isRecordValue(value: CliValue | undefined): value is { [key: string]: CliValue } {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function parseOption(field: CliField, value: string, previous: CliValue | undefined): CliValue {
  try {
    if (field.kind === "array") {
      const item = coercePrimitive(field.itemKind ?? "string", value);
      const items: CliValue[] = [];
      if (Array.isArray(previous)) {
        for (const entry of previous) {
          const itemValue: unknown = entry;
          if (isCliValue(itemValue)) items.push(itemValue);
        }
      }
      items.push(item);
      return items;
    }
    if (field.kind === "record") {
      const [key, parsed] = parseRecordEntry(value, field.itemKind);
      const record: { [key: string]: CliValue } = {};
      if (isRecordValue(previous)) {
        for (const [entryKey, entryValue] of Object.entries(previous))
          record[entryKey] = entryValue;
      }
      record[key] = parsed;
      return record;
    }
    return coercePrimitive(field.kind, value);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : "invalid value");
  }
}

function appendRequired(description: string): string {
  return description === "" ? "(required)" : `${description} (required)`;
}

function optionFlags(field: CliField): string {
  const long = `--${field.flag}`;
  const token = field.kind === "boolean" ? "" : ` <${tokenName(field.kind)}>`;
  const body = `${long}${token}`;
  return body;
}

function tokenName(kind: CliField["kind"]): string {
  if (kind === "integer") return "integer";
  if (kind === "number") return "number";
  if (kind === "date") return "date";
  if (kind === "bigint") return "bigint";
  if (kind === "json" || kind === "array") return "json";
  if (kind === "record") return "key=value";
  return "value";
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
