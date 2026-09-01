import path from "node:path";

import { isHelpFlag } from "../../argv.ts";
import { forwardAgentBrowser } from "../../runtime/browser.ts";
import { currentRun, readJsonField } from "../../runtime/fs.ts";
import { BIN, BROWSER_SESSION, CURRENT_LINK } from "./config.ts";

const usageText = `Usage:
  ${BIN} browser snapshot
  ${BIN} browser connect [port]
  ${BIN} browser <agent-browser argv…>

Forwards to agent-browser with --session ${BROWSER_SESSION} and --cdp from the current run.
Do not open http://localhost:4190/ or http://localhost:5173/ and call that desktop.
`;

export async function browser(args: string[]): Promise<void> {
  if (isHelpFlag(args[0])) {
    process.stdout.write(usageText);
    return;
  }
  const runDir = currentRun(CURRENT_LINK);
  if (runDir === undefined) {
    throw new Error(`no current run. Launch first: ${BIN} launch`);
  }
  const cdpPort = readJsonField<number>(path.join(runDir, "meta.json"), "cdpPort");
  const forwarded =
    args[0] === "connect" && args.length === 1 ? ["connect", String(cdpPort)] : args;
  forwardAgentBrowser(forwarded, { session: BROWSER_SESSION, cdpPort });
}
