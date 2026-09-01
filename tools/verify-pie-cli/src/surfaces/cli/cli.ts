import { VerifyError } from "../../runtime/fail.ts";
import { cleanup } from "./cleanup.ts";
import { doctor } from "./doctor.ts";
import { evidence } from "./evidence.ts";
import { launch } from "./launch.ts";
import { run } from "./run.ts";

const usageText = `Usage:
  pie-verify cli launch [--replace] [--serve]
  pie-verify cli doctor
  pie-verify cli run <pie argv…>
  pie-verify cli evidence path|init|curl|note
  pie-verify cli cleanup [run-dir]

TypeScript helpers from tools/verify-pie-cli, executed with Node >= 24 (not Bash, not Bun).
`;

export async function runCliSurface(argv: string[]): Promise<void> {
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
    case "run":
      await run(rest);
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
