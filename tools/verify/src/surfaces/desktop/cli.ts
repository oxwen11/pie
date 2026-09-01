import { VerifyError } from "../../runtime/fail.ts";
import { cleanup } from "./cleanup.ts";
import { doctor } from "./doctor.ts";
import { evidence } from "./evidence.ts";
import { launch } from "./launch.ts";

const usageText = `Usage:
  pie-verify desktop launch [--replace]
  pie-verify desktop doctor
  pie-verify desktop evidence path|init|screenshot|snapshot|curl|side-effects|note
  pie-verify desktop cleanup [run-dir]

TypeScript helpers from @getpie/verify, executed with Node >= 24 (not Bash, not Bun).
`;

export async function runDesktopSurface(argv: string[]): Promise<void> {
  const command = argv[0];
  const rest = argv.slice(1);
  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(usageText);
      return;
    case "launch":
      await launch(rest);
      return;
    case "doctor":
      await doctor();
      return;
    case "evidence":
      await evidence(rest);
      return;
    case "cleanup":
      await cleanup(rest);
      return;
    default:
      throw new VerifyError(`${usageText}unknown command ${command}`, 2);
  }
}
