import { defaultSurfaceFromEnv, parsePieVerifyArgv, pieVerifyUsage } from "./argv.ts";
import { VerifyError } from "./runtime/fail.ts";
import { assertNode24 } from "./runtime/process.ts";
import { runCliSurface } from "./surfaces/cli/cli.ts";
import { runDesktopSurface } from "./surfaces/desktop/cli.ts";
import { runWebSurface } from "./surfaces/web/cli.ts";

async function main(argv: string[]): Promise<void> {
  assertNode24();
  const parsed = parsePieVerifyArgv(argv, { defaultSurface: defaultSurfaceFromEnv() });
  switch (parsed.kind) {
    case "help":
      process.stdout.write(pieVerifyUsage());
      return;
    case "surface":
      switch (parsed.surface) {
        case "web":
          await runWebSurface(parsed.rest);
          return;
        case "cli":
          await runCliSurface(parsed.rest);
          return;
        case "desktop":
          await runDesktopSurface(parsed.rest);
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
