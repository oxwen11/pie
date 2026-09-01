import { VerifyError } from "../../verify-runtime/src/fail.ts";
import { assertNode24 } from "../../verify-runtime/src/process.ts";
import { cleanup } from "./cleanup.ts";
import { doctor } from "./doctor.ts";
import { evidence } from "./evidence.ts";
import { launch } from "./launch.ts";

const usageText = `Usage:
  verify-pie-desktop launch [--replace]
  verify-pie-desktop doctor
  verify-pie-desktop evidence path|init|screenshot|snapshot|curl|side-effects|note
  verify-pie-desktop cleanup [run-dir]

TypeScript helpers, executed with Node >= 24 (not Bash, not Bun).
See .cursor/skills/verify-runtime/README.md
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
    case "evidence":
      await evidence(rest);
      return;
    case "cleanup":
      await cleanup(rest);
      return;
    default: {
      const _unknown: never = command as never;
      void _unknown;
      throw new VerifyError(`${usageText}unknown command ${command}`, 2);
    }
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith("verify-pie-desktop") ? message : `verify-pie-desktop: ${message}`);
  process.exit(error instanceof VerifyError ? error.exitCode : 1);
}
