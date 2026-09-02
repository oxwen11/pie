import { isHelpFlag, surfaceUsage } from "./argv.ts";
import { cleanup } from "./lifecycle/cleanup.ts";
import { doctor } from "./lifecycle/doctor.ts";
import { printEnv } from "./lifecycle/env.ts";
import { evidence } from "./lifecycle/evidence.ts";
import { launch } from "./lifecycle/launch.ts";
import { VerifyError } from "./runtime/fail.ts";
import type { Surface } from "./surface.ts";
import { runPie } from "./surfaces/cli.ts";
import { browserDesktop } from "./surfaces/desktop.ts";
import { browserWeb } from "./surfaces/web.ts";

export async function dispatchCommands(surface: Surface, argv: string[]): Promise<void> {
  const command = argv[0];
  const rest = argv.slice(1);
  if (isHelpFlag(command)) {
    process.stdout.write(surfaceUsage(surface.identity.id));
    return;
  }
  switch (command) {
    case "launch":
      await launch(surface, rest);
      return;
    case "doctor":
      await doctor(surface);
      return;
    case "cleanup":
      await cleanup(surface, rest);
      return;
    case "evidence":
      await evidence(surface, rest);
      return;
    case "env":
      printEnv(surface, rest);
      return;
    case "browser":
      switch (surface.identity.id) {
        case "cli":
          throw new VerifyError(
            `${surface.identity.bin} has no browser — this surface is pie / pie daemon / pie serve. Drive it with \`${surface.identity.bin} run\`. Load isolation with \`pie-verify web env\` or \`pie-verify desktop env\`, then call \`$AGENT_BROWSER\`.`,
            2,
          );
        case "web":
          await browserWeb(rest);
          return;
        case "desktop":
          await browserDesktop(rest);
          return;
        default: {
          const exhaustive: never = surface.identity;
          void exhaustive;
          throw new VerifyError("unknown surface", 2);
        }
      }
    case "run":
      if (surface.identity.id !== "cli") {
        throw new VerifyError(`${surfaceUsage(surface.identity.id)}unknown command ${command}`, 2);
      }
      await runPie(rest);
      return;
    default:
      throw new VerifyError(`${surfaceUsage(surface.identity.id)}unknown command ${command}`, 2);
  }
}
