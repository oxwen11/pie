import { Data } from "effect";

export class SshHostDiscoveryError extends Data.TaggedError("SshHostDiscoveryError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class SshInvalidTargetError extends Data.TaggedError("SshInvalidTargetError")<{
  readonly message: string;
}> {}

export class SshCommandError extends Data.TaggedError("SshCommandError")<{
  readonly message: string;
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout?: string;
  readonly cause?: unknown;
}> {}

export class SshLaunchError extends Data.TaggedError("SshLaunchError")<{
  readonly message: string;
  readonly stdout: string;
  readonly cause?: unknown;
}> {}

export class SshReadinessError extends Data.TaggedError("SshReadinessError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class SshPasswordPromptError extends Data.TaggedError("SshPasswordPromptError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type SshEnvironmentError =
  | SshCommandError
  | SshInvalidTargetError
  | SshLaunchError
  | SshReadinessError
  | SshPasswordPromptError
  | SshHostDiscoveryError;
