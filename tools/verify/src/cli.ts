import { parsePieVerifyArgv, pieVerifyUsage } from "./argv.ts";
import { dispatchCommands } from "./commands.ts";
import { VerifyError } from "./runtime/fail.ts";
import { assertNode24 } from "./runtime/process.ts";
import { cliSurface } from "./surfaces/cli.ts";
import { desktopSurface } from "./surfaces/desktop.ts";
import { webSurface } from "./surfaces/web.ts";

async function main(argv: string[]): Promise<void> {
  assertNode24();
  const parsed = parsePieVerifyArgv(argv);
  switch (parsed.kind) {
    case "help":
      process.stdout.write(pieVerifyUsage());
      return;
    case "surface":
      switch (parsed.surface) {
        case "web":
          await dispatchCommands(webSurface, parsed.rest);
          return;
        case "cli":
          await dispatchCommands(cliSurface, parsed.rest);
          return;
        case "desktop":
          await dispatchCommands(desktopSurface, parsed.rest);
          return;
        default: {
          const exhaustive: never = parsed.surface;
          void exhaustive;
          throw new VerifyError("unknown surface", 2);
        }
      }
    default: {
      const exhaustive: never = parsed;
      void exhaustive;
      throw new VerifyError("unhandled argv", 2);
    }
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith("pie-verify") ? message : `pie-verify: ${message}`);
  process.exitCode = error instanceof VerifyError ? error.exitCode : 1;
}
