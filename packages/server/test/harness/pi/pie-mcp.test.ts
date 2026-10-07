import { describe, expect, it } from "vitest";

import {
  agentMcpListenUrl,
  agentMcpSession,
  issueAgentMcpToken,
  pieMcpExtensionPath,
  revokeAgentMcpToken,
} from "../../../src/pi/pie-mcp";

describe("pie mcp extension", () => {
  it("resolves an absolute extension file", () => {
    const extension = pieMcpExtensionPath();
    expect(extension).toEqual(expect.stringMatching(/pie-mcp-extension\.js$/));
    expect(extension?.startsWith("/")).toBe(true);
  });

  it("maps an issued token to the Session it was issued for, until revoke", () => {
    const ref = { projectId: "p", sessionId: "s" };
    const other = { projectId: "p", sessionId: "t" };
    const token = issueAgentMcpToken(ref);
    const otherToken = issueAgentMcpToken(other);
    expect(agentMcpSession(token)).toEqual(ref);
    expect(agentMcpSession(otherToken)).toEqual(other);
    expect(agentMcpSession("nope")).toBeUndefined();
    expect(agentMcpSession(null)).toBeUndefined();
    revokeAgentMcpToken(token);
    expect(agentMcpSession(token)).toBeUndefined();
    expect(agentMcpSession(otherToken)).toEqual(other);
    revokeAgentMcpToken(otherToken);
  });

  it("dials loopback when the bind address is unspecified", () => {
    expect(agentMcpListenUrl("0.0.0.0", 4182)).toBe("http://127.0.0.1:4182/mcp");
    expect(agentMcpListenUrl("::", 4182)).toBe("http://127.0.0.1:4182/mcp");
  });
});
