import path from "node:path";

import { Effect, FileSystem } from "effect";

export const PLUGIN_URL_PREFIX = "/plugins/";

/** Plugin directory names are the public id. No slashes, dots-only `..`, or spaces. */
export const PLUGIN_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export interface PanelPlugin {
  readonly id: string;
  readonly title: string;
  /** Same-origin path the iframe loads, e.g. `/plugins/demo/index.html`. */
  readonly url: string;
}

export function isPluginId(id: string): boolean {
  return PLUGIN_ID_PATTERN.test(id);
}

export function pluginPanelUrl(id: string, entry: string): string {
  return `${PLUGIN_URL_PREFIX}${id}/${entry.split(path.sep).join("/")}`;
}

/**
 * Map `/plugins/<id>/<entry>` onto `$PIE_HOME/plugins/<id>/<entry>`.
 * Rejects anything that would leave that plugin directory.
 */
export function resolvePluginFile(pluginsDir: string, pathname: string): string | null {
  if (!pathname.startsWith(PLUGIN_URL_PREFIX)) return null;
  const rest = pathname.slice(PLUGIN_URL_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const id = rest.slice(0, slash);
  if (!isPluginId(id)) return null;
  let relative: string;
  try {
    relative = decodeURIComponent(rest.slice(slash + 1));
  } catch {
    return null;
  }
  if (relative.length === 0 || path.isAbsolute(relative)) return null;
  const segments = relative.split(/[\\/]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  const root = path.resolve(pluginsDir, id);
  const target = path.resolve(root, ...segments);
  const rel = path.relative(root, target);
  if (rel.length === 0 || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

interface PanelManifest {
  readonly title?: string;
  readonly entry?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parsePanelManifest(raw: unknown): PanelManifest | null {
  if (!isRecord(raw)) return null;
  return {
    title: optionalNonEmptyString(raw.title),
    entry: optionalNonEmptyString(raw.entry),
  };
}

const DEFAULT_ENTRIES = ["index.html", "panel.html"] as const;

function isSafeEntry(entry: string): boolean {
  if (path.isAbsolute(entry)) return false;
  const segments = entry.split(/[\\/]/);
  return (
    segments.length > 0 &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

/**
 * A pie panel plugin is a `$PIE_HOME/plugins/<id>/` directory that has a
 * panel entry (`index.html` / `panel.html`, or `panel.json` `{ title, entry? }`).
 * Directories without a panel file are ignored (Pi-only extensions stay dark).
 */
export const listPanelPlugins = (
  pluginsDir: string,
): Effect.Effect<readonly PanelPlugin[], never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const names = yield* fs.readDirectory(pluginsDir).pipe(Effect.orElseSucceed(() => []));
    const plugins: PanelPlugin[] = [];
    for (const name of Array.from(names).sort((left, right) => left.localeCompare(right))) {
      if (!isPluginId(name)) continue;
      const plugin = yield* readPanelPlugin(fs, pluginsDir, name);
      if (plugin !== null) plugins.push(plugin);
    }
    return plugins;
  });

const readPanelPlugin = (
  fs: FileSystem.FileSystem,
  pluginsDir: string,
  id: string,
): Effect.Effect<PanelPlugin | null> =>
  Effect.gen(function* () {
    const dir = path.join(pluginsDir, id);
    const info = yield* fs.stat(dir).pipe(Effect.orElseSucceed(() => undefined));
    if (info?.type !== "Directory") return null;

    const manifestRaw = yield* fs.readFileString(path.join(dir, "panel.json")).pipe(
      Effect.map((text) => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return undefined;
        }
      }),
      Effect.orElseSucceed(() => undefined),
    );
    const manifest = manifestRaw === undefined ? undefined : parsePanelManifest(manifestRaw);
    const requested = manifest?.entry;
    const candidates = requested === undefined ? DEFAULT_ENTRIES : [requested];
    for (const entry of candidates) {
      if (!isSafeEntry(entry)) continue;
      const file = path.join(dir, entry);
      const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
      if (!exists) continue;
      return {
        id,
        title: manifest?.title ?? id,
        url: pluginPanelUrl(id, entry),
      };
    }
    return null;
  });
