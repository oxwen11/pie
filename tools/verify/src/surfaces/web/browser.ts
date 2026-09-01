import { isHelpFlag } from "../../argv.ts";
import { browserNeedsIsolation, forwardAgentBrowser } from "../../runtime/browser.ts";
import { currentRun } from "../../runtime/fs.ts";
import { BIN, BROWSER_SESSION, CURRENT_LINK, VITE_PORT } from "./config.ts";

const usageText = `Usage:
  ${BIN} browser open [url]
  ${BIN} browser snapshot
  ${BIN} browser install|skills|--version
  ${BIN} browser <agent-browser argv…>

Uses the agent-browser dependency of @getpie/verify with --session ${BROWSER_SESSION}.
\`open\` with no URL uses http://localhost:${VITE_PORT}/.
`;

export async function browser(args: string[]): Promise<void> {
  if (isHelpFlag(args[0])) {
    process.stdout.write(usageText);
    return;
  }
  if (browserNeedsIsolation(args[0]) && currentRun(CURRENT_LINK) === undefined) {
    throw new Error(`no current run. Launch first: ${BIN} launch`);
  }
  forwardAgentBrowser(args, {
    session: BROWSER_SESSION,
    defaultOpenUrl: `http://localhost:${VITE_PORT}/`,
  });
}
