import {
  generate,
  type CommandDescriptor,
  type FlagType,
  type Shell,
} from "effect/unstable/cli/Completions";

import type { CliCommandSpec, CliField } from "./metadata";

export function completionScript(
  executableName: string,
  specs: readonly CliCommandSpec[],
  shell: Shell = "bash",
): string {
  return generate(executableName, shell, {
    name: executableName,
    description: undefined,
    flags: [],
    arguments: [],
    subcommands: childDescriptors(specs, []),
  });
}

function childDescriptors(
  specs: readonly CliCommandSpec[],
  prefix: readonly string[],
): CommandDescriptor[] {
  const names = [
    ...new Set(
      specs
        .filter(
          (spec) =>
            spec.path.length > prefix.length &&
            prefix.every((part, index) => spec.path[index] === part),
        )
        .map((spec) => spec.path[prefix.length])
        .filter((part) => part !== undefined),
    ),
  ];
  return names.map((name) => descriptor(name, specs, [...prefix, name]));
}

function descriptor(
  name: string,
  specs: readonly CliCommandSpec[],
  path: readonly string[],
): CommandDescriptor {
  const leaf = specs.find(
    (spec) =>
      spec.path.length === path.length && spec.path.every((part, index) => part === path[index]),
  );
  return {
    name,
    description: leaf?.meta.description,
    flags: (leaf?.fields ?? [])
      .filter((field) => field.positional !== true && field.hidden !== true)
      .map(flagDescriptor),
    arguments: (leaf?.fields ?? [])
      .filter((field) => field.positional === true)
      .map((field) => ({
        name: field.flag,
        description: field.description || undefined,
        required: field.required,
        variadic: false,
        type: { _tag: "String" as const },
      })),
    subcommands: childDescriptors(specs, path),
  };
}

function flagDescriptor(field: CliField): CommandDescriptor["flags"][number] {
  return {
    name: field.flag,
    aliases: field.alias === undefined ? [] : [field.alias],
    description: field.description || undefined,
    type: flagType(field),
  };
}

function flagType(field: CliField): FlagType {
  if (field.kind === "boolean") return { _tag: "Boolean" };
  if (field.kind === "integer") return { _tag: "Int" };
  if (field.kind === "number") return { _tag: "Finite" };
  if (field.kind === "date") return { _tag: "Date" };
  if (field.choices !== undefined) return { _tag: "Choice", values: field.choices };
  return { _tag: "String" };
}
