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
import * as SchemaAST from "effect/SchemaAST";

export interface CliMeta {
  description?: string;
}

export interface CliAdapterOptions {
  router: AnyRouter;
  /** Passed to `call`. This package does not authenticate or authorize. */
  context?: Context;
}

export interface CliField {
  key: string;
  flag: string;
  required: boolean;
  description: string;
  kind: FieldKind;
  itemKind?: "string" | "number" | "boolean";
  choices?: readonly string[];
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

function fieldsFor(schema: AnySchema): CliField[] {
  if (!Schema.isSchema(schema)) return [];
  const root = stripOptional(schema.ast);
  if (!isPlainObject(root.ast)) return [];
  return collectFields(root.ast, "", !root.optional);
}

function collectFields(
  ast: SchemaAST.Objects,
  prefix: string,
  parentRequired: boolean,
): CliField[] {
  const fields: CliField[] = [];
  for (const property of ast.propertySignatures) {
    if (typeof property.name !== "string") continue;
    const child = stripOptional(property.type);
    const path = prefix === "" ? property.name : `${prefix}.${property.name}`;
    const required = parentRequired && !child.optional;
    if (isPlainObject(child.ast)) {
      fields.push(...collectFields(child.ast, path, required));
      continue;
    }
    const flag = flagName(path);
    if (fields.some((field) => field.flag === flag)) {
      throw new Error(`CLI option "--${flag}" is registered twice`);
    }
    fields.push({
      key: path,
      flag,
      required,
      description: descriptionOf(child.ast),
      ...classify(child.ast),
    });
  }
  return fields;
}

interface StrippedAst {
  ast: SchemaAST.AST;
  optional: boolean;
}

function stripOptional(ast: SchemaAST.AST): StrippedAst {
  if (
    SchemaAST.isUnion(ast) &&
    (ast.context?.isOptional === true || ast.types.some(SchemaAST.isUndefined))
  ) {
    const kept = ast.types.filter(
      (type) => !SchemaAST.isUndefined(type) && !SchemaAST.isVoid(type),
    );
    const only = kept.length === 1 ? kept[0] : undefined;
    if (only !== undefined) return { ast: stripOptional(only).ast, optional: true };
  }
  return { ast, optional: ast.context?.isOptional === true };
}

function isPlainObject(ast: SchemaAST.AST): ast is SchemaAST.Objects {
  return SchemaAST.isObjects(ast) && ast.indexSignatures.length === 0;
}

function classify(ast: SchemaAST.AST): Pick<CliField, "kind" | "choices" | "itemKind"> {
  const choices = stringChoices(ast);
  if (choices !== undefined) return { kind: "string", choices };
  if (SchemaAST.isBoolean(ast)) return { kind: "boolean" };
  if (SchemaAST.isNumber(ast)) return { kind: "number" };
  if (SchemaAST.isString(ast) || SchemaAST.isLiteral(ast)) return { kind: "string" };
  if (SchemaAST.isArrays(ast)) {
    const itemAst = ast.rest[0] ?? ast.elements[0];
    if (itemAst === undefined) return { kind: "json" };
    const item = stripOptional(itemAst).ast;
    if (SchemaAST.isString(item)) return { kind: "array", itemKind: "string" };
    if (SchemaAST.isNumber(item)) return { kind: "array", itemKind: "number" };
    if (SchemaAST.isBoolean(item)) return { kind: "array", itemKind: "boolean" };
  }
  return { kind: "json" };
}

function stringChoices(ast: SchemaAST.AST): readonly string[] | undefined {
  if (!SchemaAST.isUnion(ast)) return undefined;
  const values: string[] = [];
  for (const type of ast.types) {
    if (!SchemaAST.isLiteral(type) || typeof type.literal !== "string") return undefined;
    values.push(type.literal);
  }
  return values.length > 0 ? values : undefined;
}

function descriptionOf(ast: SchemaAST.AST): string {
  const description = ast.annotations?.description;
  return typeof description === "string" ? description : "";
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
