import { cleanup } from "./cleanup.ts";
import { doctor } from "./doctor.ts";
import { evidence } from "./evidence.ts";
import { launch } from "./launch.ts";
import { run } from "./run.ts";
import { VerifyError } from "./runtime/fail.ts";
import { assertNode24 } from "./runtime/process.ts";

const usageText = `Usage:
  verify-pie-cli launch [--replace] [--serve]
  verify-pie-cli doctor
  verify-pie-cli run <pie argv…>
  verify-pie-cli evidence path|init|curl|note
  verify-pie-cli cleanup [run-dir]

TypeScript helpers from tools/verify-pie-cli, executed with Node >= 24 (not Bash, not Bun).
`;

async function main(argv: string[]): Promise<void> {
  assertNode24();
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

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith("verify-pie-cli") ? message : `verify-pie-cli: ${message}`);
  process.exitCode = error instanceof VerifyError ? error.exitCode : 1;
}
