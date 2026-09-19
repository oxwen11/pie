import { describe, expect, it } from "vitest";

import { providerLogoSrc } from "./provider-logo";

describe("providerLogoSrc", () => {
  it("points at the models.dev logo for the Pi provider id", () => {
    expect(providerLogoSrc("anthropic")).toBe("https://models.dev/logos/anthropic.svg");
    expect(providerLogoSrc("openai-codex")).toBe("https://models.dev/logos/openai-codex.svg");
    expect(providerLogoSrc("github-copilot")).toBe("https://models.dev/logos/github-copilot.svg");
  });
});
