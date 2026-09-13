import fs from "node:fs";
import path from "node:path";
import url from "node:url";

export type ResourceArtifacts = {
  readonly workerEntry: URL;
  readonly monitorCommand: string;
};

type ResolveResourceArtifactsOptions = {
  readonly resolve?: (specifier: string) => string | undefined;
  readonly platform?: NodeJS.Platform;
};

const ASAR_SEGMENT = `${path.sep}app.asar${path.sep}`;
const ASAR_UNPACKED_SEGMENT = `${path.sep}app.asar.unpacked${path.sep}`;

export function resolveResourceArtifacts(
  options: ResolveResourceArtifactsOptions = {},
): ResourceArtifacts | undefined {
  const resolve = options.resolve ?? resolvePackageFile;
  const worker =
    resolve("@getpie/server/resource-writer") ?? resolve("@getpie/cli/resource-writer");
  if (worker === undefined) return undefined;
  const workerPath = asarUnpackedPath(worker);
  const monitorCommand = path.join(
    path.dirname(workerPath),
    `resource-monitor${(options.platform ?? process.platform) === "win32" ? ".exe" : ""}`,
  );
  if (!isFile(workerPath) || !isFile(monitorCommand)) return undefined;
  return { workerEntry: url.pathToFileURL(workerPath), monitorCommand };
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
