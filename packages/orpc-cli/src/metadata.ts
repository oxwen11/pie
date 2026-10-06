import { defineMeta, type AnySchema } from "@orpc/contract";
import {
  Lazy,
  Procedure,
  call,
  type AnyProcedure,
  type AnyRouter,
  type Context,
} from "@orpc/server";
import { Schema } from "effect";

export interface CliMeta {
  description?: string;
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
}

export interface CliField {
  key: string;
  flag: string;
  schema: CliJsonSchema;
  required: boolean;
  description: string;
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
  }),
);

/** Opt a procedure into the CLI. Unmarked procedures are not registered. */
export function cli(meta: CliMeta = {}): ReturnType<typeof cliPlugin> {
  return cliPlugin(meta);
}

export { getCliMeta };

export function readCliCommands(router: AnyRouter): readonly CliCommandSpec[] {
  const specs = collect(router).map(toSpec);
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

function toSpec(entry: {
  procedure: AnyProcedure;
  path: readonly string[];
  meta: CliMeta;
}): CliCommandSpec {
  const schema = entry.procedure["~orpc"].inputSchemas?.at(-1);
  const fields = schema === undefined ? [] : fieldsFor(schema);
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

function jsonSchemaOf(schema: AnySchema): CliJsonSchema | undefined {
  if (!Schema.isSchema(schema)) return undefined;
  try {
    return readJsonSchema(
      Schema.toStandardJSONSchemaV1(schema)["~standard"].jsonSchema.input({ target: "draft-07" }),
    );
  } catch {
    return undefined;
  }
}

function readJsonSchema(raw: Record<string, unknown>): CliJsonSchema {
  const schema: CliJsonSchema = {};
  if (typeof raw.type === "string") schema.type = raw.type;
  else if (Array.isArray(raw.type) && raw.type.every((item) => typeof item === "string")) {
    schema.type = raw.type;
  }
  if (typeof raw.description === "string") schema.description = raw.description;
  if (Array.isArray(raw.required) && raw.required.every((item) => typeof item === "string")) {
    schema.required = raw.required;
  }
  if (isRecord(raw.properties)) {
    const properties: Record<string, CliJsonSchema> = {};
    for (const [key, value] of Object.entries(raw.properties)) {
      if (isRecord(value)) properties[key] = readJsonSchema(value);
    }
    schema.properties = properties;
  }
  if (isRecord(raw.items)) schema.items = readJsonSchema(raw.items);
  if (Array.isArray(raw.enum)) schema.enum = raw.enum.filter(isEnumValue);
  const anyOf = readSchemaArray(raw.anyOf);
  const oneOf = readSchemaArray(raw.oneOf);
  if (anyOf !== undefined) schema.anyOf = anyOf;
  if (oneOf !== undefined) schema.oneOf = oneOf;
  return schema;
}

function readSchemaArray(value: unknown): CliJsonSchema[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const schemas: CliJsonSchema[] = [];
  for (const item of value) {
    if (isRecord(item)) schemas.push(readJsonSchema(item));
  }
  return schemas;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnumValue(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function fieldsFor(schema: AnySchema): CliField[] {
  const json = jsonSchemaOf(schema);
  if (json === undefined) return [];
  const unwrapped = unwrap(json);
  if (!isObjectSchema(unwrapped)) return [];
  return collectFields(unwrapped, "", true);
}

function collectFields(schema: CliJsonSchema, prefix: string, parentRequired: boolean): CliField[] {
  const required = schema.required === undefined ? new Set<string>() : new Set(schema.required);
  const fields: CliField[] = [];
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const child = unwrap(property);
    const fieldRequired = parentRequired && required.has(key);
    if (isObjectSchema(child)) {
      fields.push(...collectFields(child, path, fieldRequired));
      continue;
    }
    const flag = flagName(path);
    if (fields.some((field) => field.flag === flag)) {
      throw new Error(`CLI option "--${flag}" is registered twice`);
    }
    fields.push({
      key: path,
      flag,
      schema: child,
      required: fieldRequired,
      description: child.description ?? "",
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
