import { isHelpFlag } from "./argv.ts";
import { cleanup } from "./lifecycle/cleanup.ts";
import { doctor } from "./lifecycle/doctor.ts";
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
    case "browser":
      switch (surface.identity.id) {
        case "cli":
          throw new VerifyError(
            `${surface.identity.bin} has no browser — this surface is pie / pie daemon / pie serve. Drive it with \`${surface.identity.bin} run\`. Use \`pie-verify web browser\` or \`pie-verify desktop browser\`.`,
            2,
          );
        case "web":
          await browserWeb(rest);
          return;
        case "desktop":
          await browserDesktop(rest);
          return;
        default: {
          const exhaustive: never = surface.identity.id;
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

function surfaceUsage(id: Surface["identity"]["id"]): string {
  switch (id) {
    case "web":
      return `Usage:
  pie-verify web launch [--replace]
  pie-verify web doctor
  pie-verify web browser open|snapshot|<agent-browser argv…>
  pie-verify web evidence path|init|screenshot|snapshot|url|side-effects|note
  pie-verify web cleanup [run-dir]

TypeScript helpers from @getpie/verify, executed with Node >= 24 (not Bash, not Bun).
`;
    case "cli":
      return `Usage:
  pie-verify cli launch [--replace] [--serve]
  pie-verify cli doctor
  pie-verify cli run <pie argv…>
  pie-verify cli evidence path|init|curl|note
  pie-verify cli cleanup [run-dir]

TypeScript helpers from @getpie/verify, executed with Node >= 24 (not Bash, not Bun).
`;
    case "desktop":
      return `Usage:
  pie-verify desktop launch [--replace]
  pie-verify desktop doctor
  pie-verify desktop browser snapshot|connect|<agent-browser argv…>
  pie-verify desktop evidence path|init|screenshot|snapshot|curl|side-effects|note
  pie-verify desktop cleanup [run-dir]

TypeScript helpers from @getpie/verify, executed with Node >= 24 (not Bash, not Bun).
`;
    default: {
      const exhaustive: never = id;
      void exhaustive;
      return "";
    }
  }
}
