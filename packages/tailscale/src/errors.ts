import { Data } from "effect";

export type TailscaleStderrDiagnostic =
  | "no-existing-handler"
  | "not-logged-in"
  | "permission-denied"
  | "unknown";

export class TailscaleClientMissingError extends Data.TaggedError("TailscaleClientMissingError")<{
  readonly message: string;
  readonly command: string;
}> {}

export class TailscaleCommandError extends Data.TaggedError("TailscaleCommandError")<{
  readonly message: string;
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly stderrDiagnostic?: TailscaleStderrDiagnostic;
  readonly stderrLength?: number;
  readonly cause?: unknown;
}> {}

export class TailscaleStatusParseError extends Data.TaggedError("TailscaleStatusParseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type TailscaleEnvironmentError =
  | TailscaleClientMissingError
  | TailscaleCommandError
  | TailscaleStatusParseError;
