import type { SurfaceId } from "./identity.ts";
import { VerifyError } from "./runtime/fail.ts";

export const SURFACES = ["web", "cli", "desktop"] as const satisfies readonly SurfaceId[];

export type ParsedArgv = { kind: "help" } | { kind: "surface"; surface: SurfaceId; rest: string[] };

const TOOL_FOOTER =
  "TypeScript helpers from @getpie/verify, executed with Node >= 24 (not Bash, not Bun).\n";

function surfaceLines(id: SurfaceId): string {
  switch (id) {
    case "web":
      return `  pie-verify web launch [--replace]
  pie-verify web doctor
  pie-verify web browser open|snapshot|<agent-browser argv…>
  pie-verify web evidence path|init|screenshot|snapshot|url|side-effects|note
  pie-verify web cleanup [run-dir]`;
    case "cli":
      return `  pie-verify cli launch [--replace] [--serve]
  pie-verify cli doctor
  pie-verify cli run <pie argv…>
  pie-verify cli evidence path|init|curl|note
  pie-verify cli cleanup [run-dir]`;
    case "desktop":
      return `  pie-verify desktop launch [--replace]
  pie-verify desktop doctor
  pie-verify desktop browser snapshot|connect|<agent-browser argv…>
  pie-verify desktop evidence path|init|screenshot|snapshot|curl|side-effects|note
  pie-verify desktop cleanup [run-dir]`;
    default: {
      const exhaustive: never = id;
      void exhaustive;
      return "";
    }
  }
}

export function surfaceUsage(id: SurfaceId): string {
  return `Usage:\n${surfaceLines(id)}\n\n${TOOL_FOOTER}`;
}

export function pieVerifyUsage(): string {
  return `Usage:\n${surfaceLines("web")}\n\n${surfaceLines("cli")}\n\n${surfaceLines("desktop")}\n\n${TOOL_FOOTER}`;
}

export function isSurface(value: string | undefined): value is SurfaceId {
  switch (value) {
    case "web":
    case "cli":
    case "desktop":
      return true;
    default:
      return false;
  }
}

export function isHelpFlag(value: string | undefined): boolean {
  switch (value) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      return true;
    default:
      return false;
  }
}

export function parsePieVerifyArgv(argv: string[]): ParsedArgv {
  const first = argv[0];
  if (isSurface(first)) {
    return { kind: "surface", surface: first, rest: argv.slice(1) };
  }
  if (isHelpFlag(first)) {
    return { kind: "help" };
  }
  throw new VerifyError(`${pieVerifyUsage()}unknown surface ${first}`, 2);
}
