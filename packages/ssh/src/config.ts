import os from "node:os";
import path from "node:path";

import { Effect, FileSystem, type PlatformError } from "effect";

import { SshHostDiscoveryError } from "./errors";
import type { DiscoveredSshHost } from "./target";

const NO_HOSTS: ReadonlyArray<string> = [];

function stripInlineComment(line: string): string {
  const hashIndex = line.indexOf("#");
  return (hashIndex !== -1 ? line.slice(0, hashIndex) : line).trim();
}

function splitDirectiveArgs(value: string): ReadonlyArray<string> {
  const args: string[] = [];
  for (const rawEntry of value
    .replaceAll(/=(?!=)/gu, " ")
    .trim()
    .split(/\s+/u)) {
    const entry = rawEntry.trim();
    if (entry.length > 0) args.push(entry);
  }
  return args;
}

function expandHomePath(input: string, homeDir: string): string {
  return input.replace(/^~(?=$|\/|\\)/u, homeDir);
}

export function resolveSshConfigIncludePattern(includePattern: string, homeDir: string): string {
  const expandedPattern = expandHomePath(includePattern, homeDir);
  return path.isAbsolute(expandedPattern)
    ? expandedPattern
    : path.resolve(path.join(homeDir, ".ssh"), expandedPattern);
}

function hasSshPattern(value: string): boolean {
  return value.includes("*") || value.includes("?") || value.startsWith("!");
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function globToRegExp(pattern: string): RegExp {
  return new RegExp(
    `^${escapeRegex(pattern)
      .replaceAll(String.raw`\*`, ".*")
      .replaceAll(String.raw`\?`, ".")}$`,
    "u",
  );
}

const expandGlob = (
  pattern: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!pattern.includes("*") && !pattern.includes("?")) {
      return (yield* fs.exists(pattern)) ? [pattern] : NO_HOSTS;
    }

    const directory = path.dirname(pattern);
    const basePattern = path.basename(pattern);
    if (!(yield* fs.exists(directory))) return NO_HOSTS;

    const matcher = globToRegExp(basePattern);
    const entries = yield* fs.readDirectory(directory);
    const matchedPaths: string[] = [];
    for (const entry of entries) {
      if (!matcher.test(entry)) continue;
      const entryPath = path.join(directory, entry);
      if (yield* fs.exists(entryPath)) matchedPaths.push(entryPath);
    }
    return Array.from(matchedPaths).sort((left, right) => left.localeCompare(right));
  });

export const collectSshConfigAliasesFromFile = (
  filePath: string,
  homeDir: string,
  visited = new Set<string>(),
): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const resolvedPath = path.resolve(filePath);
    if (visited.has(resolvedPath) || !(yield* fs.exists(resolvedPath))) return NO_HOSTS;
    visited.add(resolvedPath);

    const aliases = new Set<string>();
    const raw = yield* fs.readFileString(resolvedPath);

    for (const line of raw.split(/\r?\n/u)) {
      const stripped = stripInlineComment(line);
      if (stripped.length === 0) continue;

      const [directive = "", ...rawArgs] = splitDirectiveArgs(stripped);
      const normalizedDirective = directive.toLowerCase();
      if (normalizedDirective === "include") {
        for (const includePattern of rawArgs) {
          const resolvedPattern = resolveSshConfigIncludePattern(includePattern, homeDir);
          const includedPaths = yield* expandGlob(resolvedPattern);
          for (const includedPath of includedPaths) {
            const includedAliases = yield* collectSshConfigAliasesFromFile(
              includedPath,
              homeDir,
              visited,
            );
            for (const alias of includedAliases) aliases.add(alias);
          }
        }
        continue;
      }

      if (normalizedDirective !== "host") continue;

      for (const alias of rawArgs) {
        if (alias.length === 0 || hasSshPattern(alias)) continue;
        aliases.add(alias);
      }
    }

    return Array.from(aliases).sort((left, right) => left.localeCompare(right));
  });

export const discoverSshHosts = (
  input: { readonly homeDir?: string } = {},
): Effect.Effect<ReadonlyArray<DiscoveredSshHost>, SshHostDiscoveryError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const homeDir = input.homeDir ?? os.homedir();
    if (homeDir.trim().length === 0) return [];

    const aliases = yield* collectSshConfigAliasesFromFile(
      path.join(homeDir, ".ssh", "config"),
      homeDir,
    );
    return aliases.map((alias) => ({
      alias,
      hostname: alias,
      username: null,
      port: null,
      source: "ssh-config" as const,
    }));
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SshHostDiscoveryError({
          message: "Failed to discover SSH hosts.",
          cause,
        }),
    ),
  );
