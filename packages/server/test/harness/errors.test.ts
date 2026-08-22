import { describe, expect, it } from "vitest";

import {
  AgentProcessExited,
  AgentUnavailable,
  HarnessSessionNotFound,
  PiRpcError,
} from "../../src/harness/errors";

describe("runtime errors", () => {
  it("preserves routing fields on tagged errors", () => {
    const error = new AgentUnavailable({ reason: "not installed" });

    expect(error._tag).toBe("AgentUnavailable");
    expect(error.message).toContain("not installed");
  });

  it("keeps protocol and process diagnostics typed", () => {
    const rpcError = new PiRpcError({
      command: "prompt",
      errorMessage: "internal error",
    });
    const exited = new AgentProcessExited({ code: 1 });
    const missing = new HarnessSessionNotFound({ sessionId: "session-1" });

    expect(rpcError.message).toContain("prompt");
    expect(exited.message).toContain("code 1");
    expect(missing.message).toContain("session-1");
  });
});
