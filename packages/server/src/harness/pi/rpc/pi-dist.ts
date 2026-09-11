import path from "node:path";
import url from "node:url";

/** Directory that contains the published `pi-coding-agent` dist (`index.js`). */
export function piCodingAgentDistDir(): string {
  return path.dirname(url.fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
}

/**
 * Load a file from Pi's dist that the public export map does not surface.
 * Same absolute path as the SDK's own relative imports, so module state is shared
 * (`killTrackedDetachedChildren` must see PIDs the bash tool tracked).
 */
export function importPiDist<T>(relative: string): Promise<T> {
  return import(url.pathToFileURL(path.join(piCodingAgentDistDir(), relative)).href) as Promise<T>;
}
