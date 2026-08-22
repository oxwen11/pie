import { Schema } from "effect";

// A cause's one-line story, for error messages that would otherwise swallow
// it. These messages end up in daemon logs and RPC INTERNAL responses — a
// bare "failed to open" with the cause dropped is undiagnosable in the field.
const causeSummary = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return String(cause);
};

export class AgentUnavailable extends Schema.TaggedError<AgentUnavailable>()("AgentUnavailable", {
  reason: Schema.String,
}) {
  override get message() {
    return `Pi is unavailable: ${this.reason}`;
  }
}

export class ExecutableNotFound extends Schema.TaggedError<ExecutableNotFound>()(
  "ExecutableNotFound",
  {
    executable: Schema.String,
  },
) {
  override get message() {
    return `Executable '${this.executable}' for Pi was not found.`;
  }
}

export class AgentOpenError extends Schema.TaggedError<AgentOpenError>()("AgentOpenError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Failed to open a Pi session: ${causeSummary(this.cause)}`;
  }
}

/**
 * The native session is not open in this process. Named with the Harness
 * prefix (unlike its neighbours) because the session domain has its own
 * `SessionNotFound` — metadata missing from storage — and the two used to
 * share a tag, forcing structural sniffing at the RPC error mapping.
 */
export class HarnessSessionNotFound extends Schema.TaggedError<HarnessSessionNotFound>()(
  "HarnessSessionNotFound",
  {
    sessionId: Schema.String,
  },
) {
  override get message() {
    return `Session '${this.sessionId}' was not found.`;
  }
}

export class SessionNotResumable extends Schema.TaggedError<SessionNotResumable>()(
  "SessionNotResumable",
  {
    sessionId: Schema.String,
    reason: Schema.optionalKey(Schema.String),
  },
) {
  override get message() {
    return this.reason
      ? `Session '${this.sessionId}' cannot be resumed: ${this.reason}`
      : `Session '${this.sessionId}' cannot be resumed.`;
  }
}

export class SessionClosed extends Schema.TaggedError<SessionClosed>()("SessionClosed", {
  sessionId: Schema.String,
}) {
  override get message() {
    return `Session '${this.sessionId}' is closed.`;
  }
}

export class TurnAlreadyRunning extends Schema.TaggedError<TurnAlreadyRunning>()(
  "TurnAlreadyRunning",
  {
    sessionId: Schema.String,
    turnId: Schema.optionalKey(Schema.String),
  },
) {
  override get message() {
    return this.turnId
      ? `Turn '${this.turnId}' is already running in session '${this.sessionId}'.`
      : `A turn is already running in session '${this.sessionId}'.`;
  }
}

export class AgentRequestUnavailable extends Schema.TaggedError<AgentRequestUnavailable>()(
  "AgentRequestUnavailable",
  {
    sessionId: Schema.String,
    requestId: Schema.String,
  },
) {
  override get message() {
    return `Agent request '${this.requestId}' is unavailable in session '${this.sessionId}'.`;
  }
}

export class AgentOperationError extends Schema.TaggedError<AgentOperationError>()(
  "AgentOperationError",
  {
    sessionId: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Agent operation '${this.operation}' failed for session '${this.sessionId}': ${causeSummary(this.cause)}`;
  }
}

export class PiTransportError extends Schema.TaggedError<PiTransportError>()("PiTransportError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Pi transport operation '${this.operation}' failed: ${causeSummary(this.cause)}`;
  }
}

export class PiRpcError extends Schema.TaggedError<PiRpcError>()("PiRpcError", {
  command: Schema.String,
  errorMessage: Schema.String,
}) {
  override get message() {
    return `Pi RPC command '${this.command}' failed: ${this.errorMessage}`;
  }
}

export class AgentProcessExited extends Schema.TaggedError<AgentProcessExited>()(
  "AgentProcessExited",
  {
    code: Schema.optionalKey(Schema.Number),
    signal: Schema.optionalKey(Schema.String),
    stderrTail: Schema.optionalKey(Schema.String),
  },
) {
  override get message() {
    const detail = this.stderrTail ? ` ${this.stderrTail.trim()}` : "";
    if (this.code !== undefined) {
      return `The Pi process exited with code ${this.code}.${detail}`;
    }
    if (this.signal !== undefined) {
      return `The Pi process exited from signal ${this.signal}.${detail}`;
    }
    return `The Pi process exited.${detail}`;
  }
}

export class AgentProtocolError extends Schema.TaggedError<AgentProtocolError>()(
  "AgentProtocolError",
  {
    reason: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message() {
    return `The Pi protocol failed: ${this.reason}`;
  }
}

export class CapabilityUnsupported extends Schema.TaggedError<CapabilityUnsupported>()(
  "CapabilityUnsupported",
  {
    capability: Schema.String,
  },
) {
  override get message() {
    return `Pi does not support '${this.capability}'.`;
  }
}

export type CreateSessionError = AgentUnavailable | ExecutableNotFound | AgentOpenError;

export type ResumeSessionError =
  | HarnessSessionNotFound
  | SessionNotResumable
  | AgentUnavailable
  | ExecutableNotFound
  | AgentOpenError;
