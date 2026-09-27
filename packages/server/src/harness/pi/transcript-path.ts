import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Pi's default session directory for a cwd. Does not create it.
 *  ponytail: mirrors Pi `getDefaultSessionDirPath`. Switch to `SessionManager.list`
 *  if Pi stops naming files `<timestamp>_<id>.jsonl` under that directory. */
export const piSessionDir = (cwd: string): string => {
  const resolved = path.resolve(cwd);
  const safe = `--${resolved.replace(/^[/\\]/, "").replaceAll(/[/\\:]/g, "-")}--`;
  return path.join(getAgentDir(), "sessions", safe);
};

export const transcriptPathIn = (
  dir: string,
  agentSessionId: string,
  names: ReadonlyArray<string>,
): string | undefined => {
  const suffix = `_${agentSessionId}.jsonl`;
  const name = names.find(
    (entry) => !entry.includes("/") && !entry.includes("\\") && entry.endsWith(suffix),
  );
  return name === undefined ? undefined : path.join(dir, name);
};
