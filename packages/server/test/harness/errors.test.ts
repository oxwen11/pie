import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AgentProcessExited,
  HarnessAgentNotFound,
  HarnessSessionNotFound,
  PiRpcError,
} from "../../src/harness/errors";

const isHarnessAgentNotFound = Schema.is(HarnessAgentNotFound);

describe("runtime errors", () => {
  it("preserves routing fields on tagged errors", () => {
    const error = new HarnessAgentNotFound({ harnessAgentId: "pi" });

    expect(error._tag).toBe("HarnessAgentNotFound");
    expect(error.harnessAgentId).toBe("pi");
    expect(isHarnessAgentNotFound(error)).toBe(true);
  });

  it("keeps protocol and process diagnostics typed", () => {
    const rpcError = new PiRpcError({
      command: "prompt",
      errorMessage: "internal error",
    });
    const exited = new AgentProcessExited({ harnessAgentId: "pi", code: 1 });
    const missing = new HarnessSessionNotFound({ sessionId: "session-1" });

    expect(rpcError.message).toContain("prompt");
    expect(exited.message).toContain("code 1");
    expect(missing.message).toContain("session-1");
  });
});
