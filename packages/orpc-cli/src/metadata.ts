import { defineMeta, type AnySchema } from "@orpc/contract";
import {
  Lazy,
  Procedure,
  call,
  unlazyRouter,
  type AnyProcedure,
  type AnyRouter,
  type Context,
} from "@orpc/server";
import { Schema } from "effect";
import * as SchemaAST from "effect/SchemaAST";

export interface CliOptionMeta {
  alias?: string;
  description?: string;
  hidden?: boolean;
}

export interface CliMeta {
  description?: string;
  /** Command alias, not an option alias. */
  alias?: string;
  /** Schema paths that are positional arguments, in order. */
  positionals?: readonly string[];
  /** Keys are schema paths: `path`, `ref.projectId`. */
  options?: Readonly<Record<string, CliOptionMeta>>;
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
  itemKind?: "string" | "number" | "integer" | "boolean" | "json";
  choices?: readonly string[];
  alias?: string;
  hidden?: boolean;
  positional?: boolean;
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

export type CliValue =
  | string
  | number
  | boolean
  | null
  | Date
  | bigint
  | readonly CliValue[]
  | { readonly [key: string]: CliValue };

interface InputObject {
  [key: string]: CliValue;
}

type FieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "json"
  | "date"
  | "bigint"
  | "record";

export const INPUT_KEY = "~input";

const [cliPlugin, getCliMeta] = defineMeta(
  "~cli",
  (incoming: CliMeta, current: CliMeta | undefined): CliMeta => ({
    description: incoming.description ?? current?.description,
    alias: incoming.alias ?? current?.alias,
    positionals: incoming.positionals ?? current?.positionals,
    options: { ...current?.options, ...incoming.options },
  }),
);

/** Opt a procedure into the CLI. Unmarked procedures are not registered. */
export function cli(meta: CliMeta = {}): ReturnType<typeof cliPlugin> {
  return cliPlugin(meta);
}

export { getCliMeta };

export async function readCliCommands(router: AnyRouter): Promise<readonly CliCommandSpec[]> {
  const ready = await unlazyRouter(router);
  const specs = collect(ready).map(toSpec);
  assertDistinct(specs);
  return specs;
}

export function missingRequired(
  values: Readonly<Record<string, CliValue | undefined>>,
  fields: readonly CliField[],
): string | undefined {
  if (values[INPUT_KEY] !== undefined) return undefined;
  const missing = fields.find((field) => field.required && values[field.key] === undefined);
  return missing === undefined ? undefined : `--${missing.flag}`;
}

export function inputFromValues(
  values: Readonly<Record<string, CliValue | undefined>>,
  spec: Pick<CliCommandSpec, "hasInput" | "fields">,
): CliValue | undefined {
  const inputFlag = values[INPUT_KEY];
  const entries = Object.entries(values).filter(
    (entry): entry is [string, CliValue] => entry[0] !== INPUT_KEY && entry[1] !== undefined,
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
  input: CliValue | undefined,
  context: Context | undefined,
): Promise<unknown> {
  if (context === undefined) return call(procedure, input);
  return call(procedure, input, { context });
}

export async function writeOutput(output: unknown): Promise<void> {
  if (output === undefined) return;
  if (isAsyncIterable(output)) {
    for await (const event of output) {
      process.stdout.write(`${renderValue(event)}\n`);
    }
    return;
  }
  process.stdout.write(renderOutput(output, process.stdout.isTTY));
}

export function renderOutput(output: unknown, tty: boolean | undefined): string {
  if (!tty) return `${renderValue(output)}\n`;
  if (typeof output === "string") return output.endsWith("\n") ? output : `${output}\n`;
  if (Array.isArray(output) && output.every(isRow)) return renderTable(output);
  if (typeof output === "number" || typeof output === "boolean" || typeof output === "bigint") {
    return `${String(output)}\n`;
  }
  return `${renderValue(output)}\n`;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

export function parseJson(text: string): CliValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : "invalid JSON");
  }
  if (!isJsonValue(parsed)) throw new CliUsageError("expected JSON");
  return parsed;
}

function isJsonValue(value: unknown): value is CliValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    typeof value === "object"
  );
}

function collect(router: AnyRouter): ReadonlyArray<{
  procedure: AnyProcedure;
  path: readonly string[];
  meta: CliMeta;
}> {
  const entries: Array<{ procedure: AnyProcedure; path: readonly string[]; meta: CliMeta }> = [];
  const visit = (node: unknown, path: readonly string[]): void => {
    if (node instanceof Lazy) {
      throw new TypeError(`Lazy router at "${path.join(".")}" survived unlazyRouter.`);
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
  const fields = schema === undefined ? [] : fieldsFor(schema, entry.meta);
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

function fieldsFor(schema: AnySchema, meta: CliMeta): CliField[] {
  const fields = Schema.isSchema(schema) ? fieldsFromAst(schema.ast) : fieldsFromStandard(schema);
  for (const path of meta.positionals ?? []) {
    if (!fields.some((field) => field.key === path)) {
      throw new Error(`unknown positional "${path}"`);
    }
  }
  return fields.map((field) => applyMeta(field, meta));
}

function applyMeta(field: CliField, meta: CliMeta): CliField {
  const option = meta.options?.[field.key];
  return {
    ...field,
    description: option?.description ?? field.description,
    alias: option?.alias,
    hidden: option?.hidden,
    positional: meta.positionals?.includes(field.key) === true,
  };
}

function fieldsFromAst(ast: SchemaAST.AST): CliField[] {
  const root = stripOptional(ast);
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
  if (SchemaAST.isUnion(ast)) {
    const members = ast.types.map((type) => classify(stripOptional(type).ast));
    const first = members[0];
    if (
      first !== undefined &&
      members.every((member) => member.kind === first.kind && member.kind !== "json")
    ) {
      return first;
    }
    return { kind: "json" };
  }
  if (SchemaAST.isBoolean(ast)) return { kind: "boolean" };
  if (SchemaAST.isNumber(ast)) {
    return { kind: integerNumber(ast) ? "integer" : "number" };
  }
  if (SchemaAST.isBigInt(ast)) return { kind: "bigint" };
  if (isDate(ast)) return { kind: "date" };
  if (SchemaAST.isString(ast) || SchemaAST.isLiteral(ast)) return { kind: "string" };
  if (
    SchemaAST.isObjects(ast) &&
    ast.indexSignatures.length > 0 &&
    ast.propertySignatures.length === 0
  ) {
    const index = ast.indexSignatures[0];
    const item = index === undefined ? undefined : classify(stripOptional(index.type).ast);
    if (
      item?.kind === "string" ||
      item?.kind === "number" ||
      item?.kind === "integer" ||
      item?.kind === "boolean"
    ) {
      return { kind: "record", itemKind: item.kind };
    }
    return { kind: "json" };
  }
  if (SchemaAST.isArrays(ast)) {
    const itemAst = ast.rest[0] ?? ast.elements[0];
    if (itemAst === undefined) return { kind: "json" };
    const item = classify(stripOptional(itemAst).ast);
    if (
      item.kind === "string" ||
      item.kind === "number" ||
      item.kind === "integer" ||
      item.kind === "boolean"
    ) {
      return { kind: "array", itemKind: item.kind };
    }
    return { kind: "array", itemKind: "json" };
  }
  return { kind: "json" };
}

function integerNumber(ast: SchemaAST.Number): boolean {
  return ast.checks?.some((check) => check.annotations?.expected === "an integer") === true;
}

function isDate(ast: SchemaAST.AST): boolean {
  if (!SchemaAST.isDeclaration(ast)) return false;
  const representation = ast.annotations?.representation;
  return isRecord(representation) && representation.id === "effect/schema/Date";
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

function fieldsFromStandard(schema: AnySchema): CliField[] {
  const raw = standardJson(schema);
  if (raw === undefined || !isRecord(raw) || raw.type !== "object" || !isRecord(raw.properties)) {
    return [];
  }
  const required = new Set(
    Array.isArray(raw.required) ? raw.required.filter((item) => typeof item === "string") : [],
  );
  return Object.entries(raw.properties).flatMap(([key, value]) => {
    if (!isRecord(value)) return [];
    return [
      {
        key,
        flag: flagName(key),
        required: required.has(key),
        description: typeof value.description === "string" ? value.description : "",
        kind: jsonKind(value),
      } satisfies CliField,
    ];
  });
}

function isJsonInput(value: unknown): value is (options: { readonly target: string }) => unknown {
  return typeof value === "function";
}

function standardJson(schema: AnySchema): unknown {
  const standard = schema["~standard"];
  if (!isRecord(standard) || !isRecord(standard.jsonSchema)) return undefined;
  const input = standard.jsonSchema.input;
  if (!isJsonInput(input)) return undefined;
  return input({ target: "draft-07" });
}

function jsonKind(raw: Record<string, unknown>): FieldKind {
  if (raw.type === "boolean") return "boolean";
  if (raw.type === "integer") return "integer";
  if (raw.type === "number") return "number";
  if (raw.type === "array") return "array";
  if (raw.type === "object") return "json";
  return "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseInteger(value: string): number {
  if (!/^-?\d+$/.test(value)) throw new CliUsageError(`expected an integer, got "${value}"`);
  return Number(value);
}

export function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new CliUsageError(`expected a date, got "${value}"`);
  return date;
}

export function parseBigint(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new CliUsageError(`expected a bigint, got "${value}"`);
  }
}

export function parseRecordEntry(
  value: string,
  kind: CliField["itemKind"],
): readonly [string, CliValue] {
  const eq = value.indexOf("=");
  if (eq <= 0) throw new CliUsageError(`expected key=value, got "${value}"`);
  return [value.slice(0, eq), coercePrimitive(kind ?? "string", value.slice(eq + 1))];
}

export function coercePrimitive(
  kind: NonNullable<CliField["itemKind"]> | FieldKind,
  value: string,
): CliValue {
  if (kind === "integer") return parseInteger(value);
  if (kind === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new CliUsageError(`expected a number, got "${value}"`);
    return parsed;
  }
  if (kind === "boolean") return value !== "false";
  if (kind === "date") return parseDate(value);
  if (kind === "bigint") return parseBigint(value);
  if (kind === "json") return parseJson(value);
  return value;
}

function renderValue(value: unknown): string {
  const line = JSON.stringify(value, bigintReplacer);
  return line ?? "null";
}

function bigintReplacer(_key: string, nested: unknown): unknown {
  return typeof nested === "bigint" ? nested.toString() : nested;
}

function isRow(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function renderTable(rows: readonly Record<string, unknown>[]): string {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cells = rows.map((row) => keys.map((key) => formatCell(row[key])));
  const widths = keys.map((key, index) =>
    Math.max(key.length, ...cells.map((row) => row[index]?.length ?? 0)),
  );
  const line = (values: readonly string[]) =>
    values.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  ");
  return `${[line(keys), line(widths.map((width) => "-".repeat(width))), ...cells.map(line)].join("\n")}\n`;
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return renderValue(value);
}

export async function promptMissing(
  fields: readonly CliField[],
  values: Record<string, CliValue | undefined>,
  ask?: (field: CliField) => Promise<string>,
): Promise<void> {
  const read = ask ?? (process.stdin.isTTY && process.stdout.isTTY ? ttyAsk : undefined);
  if (read === undefined) return;
  for (const field of fields) {
    if (!field.required || field.positional || values[field.key] !== undefined) continue;
    if (
      field.kind === "boolean" ||
      field.kind === "array" ||
      field.kind === "json" ||
      field.kind === "record"
    )
      continue;
    values[field.key] = coercePrimitive(field.kind, await read(field));
  }
}

async function ttyAsk(field: CliField): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`--${field.flag}: `);
  } finally {
    rl.close();
  }
}

function assign(target: InputObject, path: string, value: CliValue): void {
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

function isInputObject(value: CliValue | undefined): value is InputObject {
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
