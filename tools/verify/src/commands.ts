import { isHelpFlag } from "./argv.ts";
import { cleanup } from "./lifecycle/cleanup.ts";
import { doctor } from "./lifecycle/doctor.ts";
import { evidence } from "./lifecycle/evidence.ts";
import { launch } from "./lifecycle/launch.ts";
import { VerifyError } from "./runtime/fail.ts";
import type { SurfaceDefinition } from "./surface.ts";

export async function dispatchCommands(surface: SurfaceDefinition, argv: string[]): Promise<void> {
  const command = argv[0];
  const rest = argv.slice(1);
  if (isHelpFlag(command)) {
    process.stdout.write(surface.usage);
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
      if (surface.browser === undefined) {
        throw new VerifyError(
          `${surface.identity.bin} has no browser — this surface is pie / pie daemon / pie serve. Drive it with \`${surface.identity.bin} run\`. Use \`pie-verify web browser\` or \`pie-verify desktop browser\`.`,
          2,
        );
      }
      await surface.browser(rest);
      return;
    case "run":
      if (surface.run === undefined) {
        throw new VerifyError(`${surface.usage}unknown command ${command}`, 2);
      }
      await surface.run(rest);
      return;
    default:
      throw new VerifyError(`${surface.usage}unknown command ${command}`, 2);
  }
}
