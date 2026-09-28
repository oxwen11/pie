import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Pi's default session directory without `getDefaultSessionDir`'s mkdir.
 *  ponytail: mirrors Pi's private path encoding; use its public path getter if one becomes read-only. */
export const piSessionDir = (cwd: string): string => {
  const resolved = path.resolve(cwd);
  const safe = `--${resolved.replace(/^[/\\]/, "").replaceAll(/[/\\:]/g, "-")}--`;
  return path.join(getAgentDir(), "sessions", safe);
};
