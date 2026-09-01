import { userDataDir, type SurfaceId } from "./identity.ts";
import { isoNow, readJson, writeJson } from "./runtime/fs.ts";
import type { LaunchCtx } from "./surface.ts";

type RunMetaBase = {
  runId: string;
  repo: string;
  pieHome: string;
  piePort: number;
  startedAt: string;
};

export type WebRunMeta = RunMetaBase & {
  surface: "web";
  vitePort: number;
  appUrl: string;
  sampleProject: string;
  createdSample: boolean;
};

export type CliRunMeta = RunMetaBase & {
  surface: "cli";
  mode: "daemon" | "serve";
  daemonDir: string;
  address?: string;
  daemonPid?: number;
};

export type DesktopRunMeta = RunMetaBase & {
  surface: "desktop";
  daemonDir: string;
  cdpPort: number;
  userData: string;
  sampleProject: string;
  createdSample: boolean;
  address?: string;
  daemonPid?: number;
};

export type RunMeta = WebRunMeta | CliRunMeta | DesktopRunMeta;

export function writeRunMeta(filePath: string, meta: RunMeta): void {
  writeJson(filePath, meta);
}

export function readRunMeta(filePath: string): RunMeta {
  const data = readJson<Record<string, unknown>>(filePath);
  const surface = data.surface;
  switch (surface) {
    case "web":
      return parseWeb(data, filePath);
    case "cli":
      return parseCli(data, filePath);
    case "desktop":
      return parseDesktop(data, filePath);
    default:
      throw new TypeError(`invalid surface in ${filePath}`);
  }
}

export function tryReadRunMeta(filePath: string): RunMeta | undefined {
  try {
    return readRunMeta(filePath);
  } catch {
    return undefined;
  }
}

export function expectMeta<S extends SurfaceId>(
  meta: RunMeta,
  surface: S,
): Extract<RunMeta, { surface: S }> {
  if (meta.surface !== surface) {
    throw new TypeError(`expected ${surface} meta, got ${meta.surface}`);
  }
  return meta as Extract<RunMeta, { surface: S }>;
}

export function patchRunMeta<S extends SurfaceId>(
  filePath: string,
  surface: S,
  patch: Partial<Omit<Extract<RunMeta, { surface: S }>, "surface">>,
): Extract<RunMeta, { surface: S }> {
  const current = expectMeta(readRunMeta(filePath), surface);
  const next = { ...current, ...patch };
  writeRunMeta(filePath, next);
  return next;
}

export function initialMeta(ctx: LaunchCtx): RunMeta {
  const base = {
    runId: ctx.runId,
    repo: ctx.repo,
    pieHome: ctx.pieHome,
    piePort: ctx.piePort,
    startedAt: isoNow(),
  };
  switch (ctx.surface) {
    case "web":
      return {
        ...base,
        surface: "web",
        vitePort: ctx.vitePort,
        appUrl: `http://localhost:${ctx.vitePort}/`,
        sampleProject: ctx.sample.path,
        createdSample: ctx.sample.created,
      };
    case "cli":
      return {
        ...base,
        surface: "cli",
        mode: ctx.request.mode ?? "daemon",
        daemonDir: ctx.daemonDir,
      };
    case "desktop":
      return {
        ...base,
        surface: "desktop",
        daemonDir: ctx.daemonDir,
        cdpPort: ctx.cdpPort,
        userData: userDataDir(ctx.cdpPort),
        sampleProject: ctx.sample.path,
        createdSample: ctx.sample.created,
      };
    default: {
      const exhaustive: never = ctx;
      void exhaustive;
      throw new Error("unhandled launch ctx");
    }
  }
}

function parseWeb(data: Record<string, unknown>, file: string): WebRunMeta {
  return {
    ...parseBase(data, file),
    surface: "web",
    vitePort: num(data, "vitePort", file),
    appUrl: str(data, "appUrl", file),
    sampleProject: str(data, "sampleProject", file),
    createdSample: bool(data, "createdSample", file),
  };
}

function parseCli(data: Record<string, unknown>, file: string): CliRunMeta {
  const mode = str(data, "mode", file);
  if (mode !== "daemon" && mode !== "serve") {
    throw new TypeError(`invalid mode in ${file}`);
  }
  return {
    ...parseBase(data, file),
    surface: "cli",
    mode,
    daemonDir: str(data, "daemonDir", file),
    address: optStr(data, "address", file),
    daemonPid: optInt(data, "daemonPid", file),
  };
}

function parseDesktop(data: Record<string, unknown>, file: string): DesktopRunMeta {
  return {
    ...parseBase(data, file),
    surface: "desktop",
    daemonDir: str(data, "daemonDir", file),
    cdpPort: num(data, "cdpPort", file),
    userData: str(data, "userData", file),
    sampleProject: str(data, "sampleProject", file),
    createdSample: bool(data, "createdSample", file),
    address: optStr(data, "address", file),
    daemonPid: optInt(data, "daemonPid", file),
  };
}

function parseBase(data: Record<string, unknown>, file: string): RunMetaBase {
  return {
    runId: str(data, "runId", file),
    repo: str(data, "repo", file),
    pieHome: str(data, "pieHome", file),
    piePort: num(data, "piePort", file),
    startedAt: str(data, "startedAt", file),
  };
}

function requireField(data: Record<string, unknown>, key: string, file: string): unknown {
  if (!Object.hasOwn(data, key) || data[key] === undefined || data[key] === null) {
    throw new TypeError(`missing ${key} in ${file}`);
  }
  return data[key];
}

function str(data: Record<string, unknown>, key: string, file: string): string {
  const value = requireField(data, key, file);
  if (typeof value !== "string") {
    throw new TypeError(`${key} in ${file} must be a string`);
  }
  return value;
}

function num(data: Record<string, unknown>, key: string, file: string): number {
  const value = requireField(data, key, file);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${key} in ${file} must be an integer`);
  }
  return value;
}

function bool(data: Record<string, unknown>, key: string, file: string): boolean {
  const value = requireField(data, key, file);
  if (typeof value !== "boolean") {
    throw new TypeError(`${key} in ${file} must be a boolean`);
  }
  return value;
}

function optStr(data: Record<string, unknown>, key: string, file: string): string | undefined {
  const value = data[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${key} in ${file} must be a string`);
  }
  return value;
}

function optInt(data: Record<string, unknown>, key: string, file: string): number | undefined {
  const value = data[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${key} in ${file} must be an integer`);
  }
  return value;
}
