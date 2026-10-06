import { defineMeta, type AnySchema } from "@orpc/contract";
import {
  Lazy,
  Procedure,
  call,
  type AnyProcedure,
  type AnyRouter,
  type Context,
} from "@orpc/server";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

export interface CliOptionMeta {
  alias?: string;
  description?: string;
  hidden?: boolean;
}

export interface CliMeta {
  description?: string;
  /** Command alias, not an option alias. */
  alias?: string;
  /** Keys are schema paths: `path`, `ref.projectId`. */
  options?: Readonly<Record<string, CliOptionMeta>>;
}

export interface CliJsonSchema {
  type?: string | readonly string[];
  description?: string;
  properties?: Readonly<Record<string, CliJsonSchema>>;
  required?: readonly string[];
  items?: CliJsonSchema;
  enum?: readonly (string | number | boolean | null)[];
  anyOf?: readonly CliJsonSchema[];
  oneOf?: readonly CliJsonSchema[];
}

export interface CreateCliOptions {
  router: AnyRouter;
  /** Passed to `call`. This package does not authenticate or authorize. */
  context?: Context;
  /** Describe `.input()` schemas. Return undefined to expose only `--input`. */
  toJsonSchema: (schema: AnySchema) => CliJsonSchema | undefined;
  name?: string;
  description?: string;
  version?: string;
  /** Register onto this program. An existing command with the same path throws. */
  program?: Command;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

interface InputObject {
  [key: string]: JsonValue;
}

interface CliField {
  key: string;
  flag: string;
  schema: CliJsonSchema;
  required: boolean;
  description: string;
  alias?: string;
  hidden?: boolean;
}

interface CliProcedure {
  procedure: AnyProcedure;
  path: readonly string[];
  meta: CliMeta;
}

const INPUT_KEY = "~input";

const [cliPlugin, getCliMeta] = defineMeta(
  "~cli",
  (incoming: CliMeta, current: CliMeta | undefined): CliMeta => ({
    description: incoming.description ?? current?.description,
    alias: incoming.alias ?? current?.alias,
    options: { ...current?.options, ...incoming.options },
  }),
);

/** Opt a procedure into the CLI. Unmarked procedures are not registered. */
export const cli = cliPlugin;

export { getCliMeta };

/**
 * Register opted-in procedures as Commander commands and return the program.
 *
 * Does not parse argv and does not `process.exit` (`exitOverride`). `--help`
 * and usage errors throw `CommanderError`; its `exitCode` is the process status.
 * Add non-oRPC commands on the returned program before `parseAsync`.
 */
export function createCli(options: CreateCliOptions): Command {
  const program = options.program ?? new Command();
  program.exitOverride();
  program.showHelpAfterError();
  program.showSuggestionAfterError();
  if (options.program === undefined) {
    if (options.name !== undefined) program.name(options.name);
    if (options.description !== undefined) program.description(options.description);
    if (options.version !== undefined) program.version(options.version);
  }

  const procedures = collectProcedures(options.router);
  assertDistinct(procedures);
  for (const entry of procedures) {
    registerProcedure(program, entry, options);
  }
  return program;
}

function collectProcedures(router: AnyRouter): CliProcedure[] {
  const entries: CliProcedure[] = [];
  const visit = (node: unknown, path: readonly string[]): void => {
    if (node instanceof Lazy) {
      throw new TypeError(`Lazy router at "${path.join(".")}". Unlazy it before createCli.`);
    }
    if (node instanceof Procedure) {
      const meta = getCliMeta(node);
      if (meta === undefined) return;
      if (path.length === 0) throw new Error("cli() procedure is missing a router path");
      entries.push({ procedure: node, path, meta });
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      visit(value, [...path, key]);
    }
  };
  visit(router, []);
  return entries;
}

function assertDistinct(procedures: readonly CliProcedure[]): void {
  const seen = new Set<string>();
  const joined = procedures.map((entry) => commandPath(entry.path).join(" "));
  for (const path of joined) {
    if (seen.has(path)) throw new Error(`CLI command "${path}" is registered twice`);
    seen.add(path);
  }
  for (const path of joined) {
    for (const other of joined) {
      if (other !== path && other.startsWith(`${path} `)) {
        throw new Error(`CLI command "${path}" conflicts with "${other}"`);
      }
    }
  }
}

function registerProcedure(program: Command, entry: CliProcedure, options: CreateCliOptions): void {
  const names = commandPath(entry.path);
  const leafName = names.at(-1);
  if (leafName === undefined) return;
  const parent = ensureParent(program, names.slice(0, -1));
  if (
    parent.commands.some(
      (command) => command.name() === leafName || command.aliases().includes(leafName),
    )
  ) {
    throw new Error(`CLI command "${names.join(" ")}" conflicts with an existing command`);
  }

  const leaf = parent.command(leafName);
  leaf.showHelpAfterError();
  if (entry.meta.description !== undefined) leaf.description(entry.meta.description);
  if (entry.meta.alias !== undefined) leaf.alias(entry.meta.alias);

  const schema = inputSchema(entry.procedure);
  const fields = schema === undefined ? [] : fieldsFor(schema, entry.meta, options.toJsonSchema);
  const claimedInput = fields.some((field) => field.flag === "input");
  for (const field of fields) addFieldOption(leaf, field);
  if (schema !== undefined && !claimedInput) {
    const inputOption = new FieldOption("--input <json>", "Procedure input as JSON", INPUT_KEY);
    inputOption.argParser(parseJson);
    if (fields.length === 0) inputOption.makeOptionMandatory(true);
    leaf.addOption(inputOption);
  }

  leaf.action(async () => {
    const missing = missingRequired(leaf, fields);
    if (missing !== undefined) {
      throw new CommanderError(
        1,
        "orpc-cli.required",
        `required option '${missing}' not specified`,
      );
    }
    const input = readInput(leaf, schema !== undefined, fields.length > 0);
    const output = await invoke(entry.procedure, input, options.context);
    writeOutput(output);
  });
}

function appendRequired(description: string): string {
  return description === "" ? "(required)" : `${description} (required)`;
}

function missingRequired(command: Command, fields: readonly CliField[]): string | undefined {
  const opts = command.opts<Record<string, JsonValue | undefined>>();
  if (opts[INPUT_KEY] !== undefined) return undefined;
  const missing = fields.find((field) => field.required && opts[field.key] === undefined);
  return missing === undefined ? undefined : `--${missing.flag}`;
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

function addFieldOption(command: Command, field: CliField): void {
  const kind = fieldKind(field.schema);
  const description = field.required ? appendRequired(field.description) : field.description;
  const option = new FieldOption(optionFlags(field, kind), description, field.key);
  if (field.hidden === true) option.hideHelp();
  if (kind === "array") {
    const items = field.schema.items ?? {};
    option.argParser((value: string, previous: JsonValue[] | undefined) => [
      ...(previous ?? []),
      coerceScalar(items, value),
    ]);
  } else if (kind === "number" || kind === "json") {
    option.argParser((value: string) => coerceScalar(field.schema, value));
  }
  const choices = stringChoices(field.schema);
  if (choices !== undefined) option.choices(choices);
  command.addOption(option);
  if (kind === "boolean") {
    const negation = new FieldOption(`--no-${field.flag}`, `Negate --${field.flag}`, field.key);
    if (field.hidden === true) negation.hideHelp();
    command.addOption(negation);
  }
}

function readInput(
  command: Command,
  hasSchema: boolean,
  hasFields: boolean,
): JsonValue | undefined {
  const opts = command.opts<Record<string, JsonValue | undefined>>();
  const inputFlag = opts[INPUT_KEY];
  const entries = Object.entries(opts).filter(
    (entry): entry is [string, JsonValue] => entry[0] !== INPUT_KEY && entry[1] !== undefined,
  );
  if (inputFlag !== undefined) {
    if (entries.length > 0) {
      throw new CommanderError(
        1,
        "orpc-cli.input",
        "--input cannot be combined with other options",
      );
    }
    return inputFlag;
  }
  if (!hasSchema) return undefined;
  if (!hasFields) return undefined;
  const input: InputObject = {};
  for (const [key, value] of entries) assign(input, key, value);
  return input;
}

async function invoke(
  procedure: AnyProcedure,
  input: JsonValue | undefined,
  context: Context | undefined,
): Promise<unknown> {
  try {
    if (context === undefined) return await call(procedure, input);
    return await call(procedure, input, { context });
  } catch (error) {
    if (error instanceof CommanderError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CommanderError(1, "orpc-cli.call", message);
  }
}

function writeOutput(output: unknown): void {
  if (output === undefined) return;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function inputSchema(procedure: AnyProcedure): AnySchema | undefined {
  return procedure["~orpc"].inputSchemas?.at(-1);
}

function fieldsFor(
  schema: AnySchema,
  meta: CliMeta,
  toJsonSchema: CreateCliOptions["toJsonSchema"],
): CliField[] {
  const json = toJsonSchema(schema);
  if (json === undefined) return [];
  const unwrapped = unwrap(json);
  if (!isObjectSchema(unwrapped)) return [];
  return collectFields(unwrapped, "", true, meta);
}

function collectFields(
  schema: CliJsonSchema,
  prefix: string,
  parentRequired: boolean,
  meta: CliMeta,
): CliField[] {
  const required = schema.required === undefined ? new Set<string>() : new Set(schema.required);
  const fields: CliField[] = [];
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const child = unwrap(property);
    const fieldRequired = parentRequired && required.has(key);
    if (isObjectSchema(child)) {
      fields.push(...collectFields(child, path, fieldRequired, meta));
      continue;
    }
    const optionMeta = meta.options?.[path];
    const flag = flagName(path);
    if (fields.some((field) => field.flag === flag)) {
      throw new Error(`CLI option "--${flag}" is registered twice`);
    }
    fields.push({
      key: path,
      flag,
      schema: child,
      required: fieldRequired,
      description: optionMeta?.description ?? child.description ?? "",
      alias: optionMeta?.alias,
      hidden: optionMeta?.hidden,
    });
  }
  return fields;
}

function unwrap(schema: CliJsonSchema): CliJsonSchema {
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches === undefined) return schema;
  const kept = branches.filter((branch) => !isNullSchema(branch));
  if (kept.length !== 1) return schema;
  const only = kept[0];
  if (only === undefined) return schema;
  return unwrap(only);
}

function isNullSchema(schema: CliJsonSchema): boolean {
  const types = schemaTypes(schema);
  return types.length === 1 && types[0] === "null";
}

function isObjectSchema(schema: CliJsonSchema): boolean {
  return schemaTypes(schema).includes("object") && schema.properties !== undefined;
}

type FieldKind = "string" | "number" | "boolean" | "array" | "json";

function fieldKind(schema: CliJsonSchema): FieldKind {
  const unwrapped = unwrap(schema);
  if (unwrapped.items !== undefined && schemaTypes(unwrapped).includes("array")) {
    const itemKind = fieldKind(unwrapped.items);
    return itemKind === "json" || itemKind === "array" ? "json" : "array";
  }
  const types = schemaTypes(unwrapped);
  if (types.includes("object")) return "json";
  if (types.length === 1 && types[0] === "boolean") return "boolean";
  if (types.includes("number") || types.includes("integer")) return "number";
  if (types.includes("string") || unwrapped.enum !== undefined) return "string";
  return "json";
}

function schemaTypes(schema: CliJsonSchema): readonly string[] {
  if (schema.type === undefined) return [];
  return typeof schema.type === "string" ? [schema.type] : schema.type;
}

function stringChoices(schema: CliJsonSchema): string[] | undefined {
  const values = unwrap(schema).enum;
  if (values === undefined || values.some((value) => typeof value !== "string")) return undefined;
  return values.filter((value): value is string => typeof value === "string");
}

function optionFlags(field: CliField, kind: FieldKind): string {
  const long = `--${field.flag}`;
  const token =
    kind === "boolean"
      ? ""
      : kind === "number"
        ? " <number>"
        : kind === "json"
          ? " <json>"
          : " <value>";
  const body = `${long}${token}`;
  if (field.alias === undefined) return body;
  const short = field.alias.length === 1 ? `-${field.alias}` : `--${field.alias}`;
  return `${short}, ${body}`;
}

function coerceScalar(schema: CliJsonSchema, value: string): JsonValue {
  const kind = fieldKind(schema);
  if (kind === "number") {
    if (value.trim() === "" || Number.isNaN(Number(value))) {
      throw new InvalidArgumentError(`expected a number, got "${value}"`);
    }
    return Number(value);
  }
  if (kind === "json") return parseJson(value);
  return value;
}

function parseJson(text: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isJsonValue(parsed)) throw new InvalidArgumentError("expected JSON");
    return parsed;
  } catch (error) {
    if (error instanceof InvalidArgumentError) throw error;
    throw new InvalidArgumentError(error instanceof Error ? error.message : "invalid JSON");
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every(isJsonValue);
  return false;
}

function assign(target: InputObject, path: string, value: JsonValue): void {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!isInputObject(next)) {
      const created: InputObject = {};
      current[part] = created;
      current = created;
      continue;
    }
    current = next;
  }
  const leaf = parts.at(-1);
  if (leaf === undefined) return;
  current[leaf] = value;
}

function isInputObject(value: JsonValue | undefined): value is InputObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandPath(path: readonly string[]): string[] {
  return path.map(kebab);
}

function flagName(path: string): string {
  return path.split(".").map(kebab).join(".");
}

function kebab(segment: string): string {
  return segment
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll(/[_\s]+/g, "-")
    .toLowerCase();
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
