import { VerifyError } from "../../runtime/fail.ts";
import { cleanup } from "./cleanup.ts";
import { doctor } from "./doctor.ts";
import { evidence } from "./evidence.ts";
import { launch } from "./launch.ts";

const usageText = `Usage:
  pie-verify web launch [--replace]
  pie-verify web doctor
  pie-verify web evidence path|init|screenshot|snapshot|url|side-effects|note
  pie-verify web cleanup [run-dir]

TypeScript helpers from tools/verify-pie-cli, executed with Node >= 24 (not Bash, not Bun).
`;

export async function runWebSurface(argv: string[]): Promise<void> {
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
