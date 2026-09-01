import path from "node:path";

import { tryReadRunMeta, type RunMeta } from "../meta.ts";
import { clearCurrentRun, currentRun, isUnder, realPath, removePath } from "../runtime/fs.ts";
import { removeScaffold } from "../runtime/scaffold.ts";
import type { Surface } from "../surface.ts";

function sampleProjectOf(meta: RunMeta | undefined): string | undefined {
  switch (meta?.surface) {
    case "web":
    case "desktop":
      return meta.sampleProject;
    case "cli":
    case undefined:
      return undefined;
    default: {
      const exhaustive: never = meta;
      void exhaustive;
      return undefined;
    }
  }
}

export async function cleanup(surface: Surface, args: string[]): Promise<void> {
  const { identity } = surface;
  const runDir =
    currentRun(identity.currentLink) ?? (args[0] === undefined ? undefined : realPath(args[0]));
  if (runDir === undefined) {
    console.log(`${identity.logPrefix}: no current run to clean up`);
    return;
  }

  const meta = tryReadRunMeta(path.join(runDir, "meta.json"));
  await surface.stop(runDir, meta);

  const sample = identity.sample;
  if (sample !== undefined) {
    removeScaffold(sampleProjectOf(meta), sample.marker, identity.logPrefix);
    removeScaffold(
      path.join(process.env.HOME ?? "", sample.name),
      sample.marker,
      identity.logPrefix,
    );
  }

  if (isUnder(path.join(identity.root, "runs"), runDir)) {
    removePath(runDir);
    console.log(`${identity.logPrefix}: removed ${runDir}`);
  }
  clearCurrentRun(identity.currentLink, runDir);
  console.log(
    `${identity.logPrefix}: cleanup done (evidence kept under ${identity.skillDir}/evidence/)`,
  );
}
