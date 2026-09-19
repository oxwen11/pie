import fs from "node:fs";
import path from "node:path";
import url from "node:url";

export type ResourceArtifacts = {
  readonly monitorCommand: string;
};

type ResolveResourceArtifactsOptions = {
  readonly resolve?: (specifier: string) => string | undefined;
  readonly platform?: NodeJS.Platform;
  readonly fallbackDirectory?: string;
};

const ASAR_SEGMENT = `${path.sep}app.asar${path.sep}`;
const ASAR_UNPACKED_SEGMENT = `${path.sep}app.asar.unpacked${path.sep}`;

export function resolveResourceArtifacts(
  options: ResolveResourceArtifactsOptions = {},
): ResourceArtifacts | undefined {
  const resolve = options.resolve ?? resolvePackageFile;
  const suffix = (options.platform ?? process.platform) === "win32" ? ".exe" : "";
  const exported =
    resolve("@getpie/server/resource-monitor") ?? resolve("@getpie/cli/resource-monitor");
  const candidates = [
    ...(exported === undefined ? [] : [asarUnpackedPath(exported)]),
    ...(options.fallbackDirectory === undefined
      ? []
      : [path.join(options.fallbackDirectory, `resource-monitor${suffix}`)]),
  ];
  for (const command of candidates) {
    const monitorCommand = command.endsWith(suffix) ? command : `${command}${suffix}`;
    if (isFile(monitorCommand)) return { monitorCommand };
  }
  return undefined;
}

function resolvePackageFile(specifier: string): string | undefined {
  try {
    return url.fileURLToPath(import.meta.resolve(specifier));
  } catch {
    return undefined;
  }
}

function asarUnpackedPath(filePath: string): string {
  const index = filePath.indexOf(ASAR_SEGMENT);
  if (index === -1) return filePath;
  return (
    filePath.slice(0, index) + ASAR_UNPACKED_SEGMENT + filePath.slice(index + ASAR_SEGMENT.length)
  );
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
