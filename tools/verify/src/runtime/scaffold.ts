import fs from "node:fs";
import path from "node:path";

import { ensureDir, removePath, writeText } from "./fs.ts";

export type SampleProjectOptions = {
  home: string;
  name: string;
  marker: string;
  readme: string;
  markerBody: string;
  logPrefix: string;
};

export type SampleProject = {
  path: string;
  created: boolean;
};

export function ensureSampleProject(options: SampleProjectOptions): SampleProject {
  const dir = path.join(options.home, options.name);
  if (!fs.existsSync(dir)) {
    ensureDir(dir);
    writeText(path.join(dir, options.marker), options.markerBody);
    writeText(path.join(dir, "README.md"), options.readme);
    return { path: dir, created: true };
  }
  if (!fs.existsSync(path.join(dir, options.marker))) {
    console.error(
      `${options.logPrefix}: ${dir} exists and is not our scaffold. Leaving it untouched.`,
    );
    return { path: dir, created: false };
  }
  return { path: dir, created: false };
}

export function removeScaffold(
  sample: string | undefined,
  marker: string,
  logPrefix: string,
): void {
  if (sample === undefined || sample === "") {
    return;
  }
  if (fs.existsSync(path.join(sample, marker))) {
    removePath(sample);
    console.log(`${logPrefix}: removed scaffolding ${sample}`);
  }
}
