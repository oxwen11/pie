import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, removePath, writeText } from "./fs.ts";

export function ensureSampleProject(options: {
  home: string;
  name: string;
  marker: string;
  readme: string;
  markerBody: string;
  logPrefix: string;
}): { path: string; created: boolean } {
  const dir = join(options.home, options.name);
  if (!existsSync(dir)) {
    ensureDir(dir);
    writeText(join(dir, options.marker), options.markerBody);
    writeText(join(dir, "README.md"), options.readme);
    return { path: dir, created: true };
  }
  if (!existsSync(join(dir, options.marker))) {
    console.error(`${options.logPrefix}: ${dir} exists and is not our scaffold. Leaving it untouched.`);
    return { path: dir, created: false };
  }
  return { path: dir, created: false };
}

export function removeScaffold(sample: string | undefined, marker: string, logPrefix: string): void {
  if (sample === undefined || sample === "") {
    return;
  }
  if (existsSync(join(sample, marker))) {
    removePath(sample);
    console.log(`${logPrefix}: removed scaffolding ${sample}`);
  }
}
