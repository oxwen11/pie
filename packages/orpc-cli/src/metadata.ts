import { defineMeta, type AnySchema } from "@orpc/contract";
import {
  Lazy,
  Procedure,
  call,
  type AnyProcedure,
  type AnyRouter,
  type Context,
} from "@orpc/server";

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

export interface CliAdapterOptions {
  router: AnyRouter;
  /** Passed to `call`. This package does not authenticate or authorize. */
  context?: Context;
  /** Describe `.input()` schemas. Return undefined to expose only `--input`. */
  toJsonSchema: (schema: AnySchema) => CliJsonSchema | undefined;
}

export interface CliField {
  key: string;
  flag: string;
  schema: CliJsonSchema;
  required: boolean;
  description: string;
  alias?: string;
  hidden?: boolean;
  kind: FieldKind;
  choices?: readonly string[];
  integer: boolean;
}

/** One opted-in procedure. Adapters turn this into a command; they do not rediscover the router. */
export interface CliCommandSpec {
  procedure: AnyProcedure;
  path: readonly string[];
  meta: CliMeta;
  fields: readonly CliField[];
  hasInput: boolean;
  jsonOnly: boolean;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
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

type FieldKind = "string" | "number" | "boolean" | "array" | "json";

export const INPUT_KEY = "~input";

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

export function readCliCommands(
  router: AnyRouter,
  toJsonSchema: CliAdapterOptions["toJsonSchema"],
): readonly CliCommandSpec[] {
  const specs = collect(router).map((entry) => toSpec(entry, toJsonSchema));
  assertDistinct(specs);
  return specs;
}

export function missingRequired(
  values: Readonly<Record<string, JsonValue | undefined>>,
  fields: readonly CliField[],
): string | undefined {
  if (values[INPUT_KEY] !== undefined) return undefined;
  const missing = fields.find((field) => field.required && values[field.key] === undefined);
  return missing === undefined ? undefined : `--${missing.flag}`;
}

export function inputFromValues(
  values: Readonly<Record<string, JsonValue | undefined>>,
  spec: Pick<CliCommandSpec, "hasInput" | "fields">,
): JsonValue | undefined {
  const inputFlag = values[INPUT_KEY];
  const entries = Object.entries(values).filter(
    (entry): entry is [string, JsonValue] => entry[0] !== INPUT_KEY && entry[1] !== undefined,
  );
  if (inputFlag !== undefined) {
    if (entries.length > 0) {
      throw new CliUsageError("--input cannot be combined with other options");
    }
    return inputFlag;
  }
  if (!spec.hasInput || spec.fields.length === 0) return undefined;
  const input: InputObject = {};
  for (const [key, value] of entries) assign(input, key, value);
  return input;
}

export async function callProcedure(
  procedure: AnyProcedure,
  input: JsonValue | undefined,
  context: Context | undefined,
): Promise<unknown> {
  if (context === undefined) return call(procedure, input);
  return call(procedure, input, { context });
}

export function writeOutput(output: unknown): void {
  if (output === undefined) return;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export function parseJson(text: string): JsonValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : "invalid JSON");
  }
  if (!isJsonValue(parsed)) throw new CliUsageError("expected JSON");
  return parsed;
}

function collect(router: AnyRouter): ReadonlyArray<{
  procedure: AnyProcedure;
  path: readonly string[];
  meta: CliMeta;
}> {
  const entries: Array<{ procedure: AnyProcedure; path: readonly string[]; meta: CliMeta }> = [];
  const visit = (node: unknown, path: readonly string[]): void => {
    if (node instanceof Lazy) {
      throw new TypeError(`Lazy router at "${path.join(".")}". Unlazy it before building a CLI.`);
    }
    if (node instanceof Procedure) {
      const meta = getCliMeta(node);
      if (meta === undefined) return;
      if (path.length === 0) throw new Error("cli() procedure is missing a router path");
      entries.push({ procedure: node, path: commandPath(path), meta });
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) visit(value, [...path, key]);
  };
  visit(router, []);
  return entries;
}

function toSpec(
  entry: { procedure: AnyProcedure; path: readonly string[]; meta: CliMeta },
  toJsonSchema: CliAdapterOptions["toJsonSchema"],
): CliCommandSpec {
  const schema = entry.procedure["~orpc"].inputSchemas?.at(-1);
  const fields = schema === undefined ? [] : fieldsFor(schema, entry.meta, toJsonSchema);
  return {
    procedure: entry.procedure,
    path: entry.path,
    meta: entry.meta,
    fields,
    hasInput: schema !== undefined,
    jsonOnly: schema !== undefined && fields.length === 0,
  };
}

function assertDistinct(specs: readonly CliCommandSpec[]): void {
  const seen = new Set<string>();
  const joined = specs.map((spec) => spec.path.join(" "));
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

function fieldsFor(
  schema: AnySchema,
  meta: CliMeta,
  toJsonSchema: CliAdapterOptions["toJsonSchema"],
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
      kind: fieldKind(child),
      choices: stringChoices(child),
      integer: schemaTypes(child).includes("integer"),
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
