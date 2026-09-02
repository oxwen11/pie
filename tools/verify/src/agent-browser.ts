import { execIsolatedAgentBrowser } from "./lifecycle/env.ts";
import { VerifyError } from "./runtime/fail.ts";

try {
  execIsolatedAgentBrowser(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith("pie-verify") ? message : `pie-verify: ${message}`);
  process.exitCode = error instanceof VerifyError ? error.exitCode : 1;
}
