import { describe, expect, it } from "vitest";

import { providerLogoSrc } from "./provider-logo";

describe("providerLogoSrc", () => {
  it("resolves built-in providers and Pi aliases", () => {
    expect(providerLogoSrc("anthropic")).toBeTruthy();
    expect(providerLogoSrc("openai-codex")).toBeTruthy();
    expect(providerLogoSrc("github-copilot")).toBeTruthy();
    expect(providerLogoSrc("qwen-token-plan-cn")).toBe(providerLogoSrc("qwen-token-plan"));
  });

  it("leaves unknown providers without a src", () => {
    expect(providerLogoSrc("my-ollama")).toBeUndefined();
    expect(providerLogoSrc("radius")).toBeUndefined();
  });
});
