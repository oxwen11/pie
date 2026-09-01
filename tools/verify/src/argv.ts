import { VerifyError } from "./runtime/fail.ts";

export const SURFACES = ["web", "cli", "desktop"] as const;
export type Surface = (typeof SURFACES)[number];

export type ParsedArgv = { kind: "help" } | { kind: "surface"; surface: Surface; rest: string[] };

const usageText = `Usage:
  pie-verify web launch [--replace]
  pie-verify web doctor
  pie-verify web browser open|snapshot|<agent-browser argv…>
  pie-verify web evidence path|init|screenshot|snapshot|url|side-effects|note
  pie-verify web cleanup [run-dir]

  pie-verify cli launch [--replace] [--serve]
  pie-verify cli doctor
  pie-verify cli run <pie argv…>
  pie-verify cli evidence path|init|curl|note
  pie-verify cli cleanup [run-dir]

  pie-verify desktop launch [--replace]
  pie-verify desktop doctor
  pie-verify desktop browser snapshot|connect|<agent-browser argv…>
  pie-verify desktop evidence path|init|screenshot|snapshot|curl|side-effects|note
  pie-verify desktop cleanup [run-dir]

TypeScript helpers from @getpie/verify, executed with Node >= 24 (not Bash, not Bun).
`;

export function pieVerifyUsage(): string {
  return usageText;
}

export function isSurface(value: string | undefined): value is Surface {
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

export function defaultSurfaceFromEnv(env: NodeJS.ProcessEnv = process.env): Surface | undefined {
  return isSurface(env.VERIFY_PIE_DEFAULT_SURFACE) ? env.VERIFY_PIE_DEFAULT_SURFACE : undefined;
}

export function parsePieVerifyArgv(
  argv: string[],
  options: { defaultSurface?: Surface } = {},
): ParsedArgv {
  const first = argv[0];
  if (isSurface(first)) {
    return { kind: "surface", surface: first, rest: argv.slice(1) };
  }
  if (options.defaultSurface !== undefined) {
    return { kind: "surface", surface: options.defaultSurface, rest: argv };
  }
  if (isHelpFlag(first)) {
    return { kind: "help" };
  }
  throw new VerifyError(`${usageText}unknown surface ${first}`, 2);
}
