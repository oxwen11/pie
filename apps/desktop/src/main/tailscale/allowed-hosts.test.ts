import { describe, expect, it } from "vitest";

import { mergePieAllowedHosts } from "./allowed-hosts";

describe("mergePieAllowedHosts", () => {
  it("leaves env unchanged when there is nothing to add", () => {
    const env = { PATH: "/usr/bin" };
    expect(mergePieAllowedHosts(env, [])).toBe(env);
  });

  it("appends a MagicDNS name without duplicating an existing allowlist", () => {
    const env = { PIE_ALLOWED_HOSTS: "proxy.ts.net,other.example" };
    expect(mergePieAllowedHosts(env, ["proxy.ts.net", "laptop.tailnet.ts.net"])).toEqual({
      PIE_ALLOWED_HOSTS: "proxy.ts.net,other.example,laptop.tailnet.ts.net",
    });
  });
});
