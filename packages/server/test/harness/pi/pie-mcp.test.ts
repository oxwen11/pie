import { describe, expect, it } from "vitest";

import {
  agentMcpListenUrl,
  agentMcpTokenMatches,
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

  it("accepts an issued token only until revoke", () => {
    const token = issueAgentMcpToken();
    expect(agentMcpTokenMatches(token)).toBe(true);
    expect(agentMcpTokenMatches("nope")).toBe(false);
    revokeAgentMcpToken(token);
    expect(agentMcpTokenMatches(token)).toBe(false);
  });

  it("dials loopback when the bind address is unspecified", () => {
    expect(agentMcpListenUrl("0.0.0.0", 4182)).toBe("http://127.0.0.1:4182/mcp");
    expect(agentMcpListenUrl("::", 4182)).toBe("http://127.0.0.1:4182/mcp");
  });
});
