export class VerifyError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "VerifyError";
    this.exitCode = exitCode;
  }
}

export function fail(message: string): never {
  throw new VerifyError(message);
}

export function usage(message: string): never {
  throw new VerifyError(message, 2);
}
