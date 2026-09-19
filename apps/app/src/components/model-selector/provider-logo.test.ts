import { afterEach, describe, expect, it, vi } from "vitest";

import { providerLogoUrl, resolveProviderLogo } from "./provider-logo";

describe("providerLogoUrl", () => {
  it("points at the models.dev logo for the Pi provider id", () => {
    expect(providerLogoUrl("anthropic")).toBe("https://models.dev/logos/anthropic.svg");
    expect(providerLogoUrl("openai-codex")).toBe("https://models.dev/logos/openai-codex.svg");
    expect(providerLogoUrl("github-copilot")).toBe("https://models.dev/logos/github-copilot.svg");
  });
});

describe("resolveProviderLogo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reuses Cache API hits without refetching", async () => {
    const svg = new Blob(["<svg/>"], { type: "image/svg+xml" });
    const match = vi.fn<() => Promise<Response | undefined>>().mockResolvedValue(new Response(svg));
    const put = vi.fn<(request: RequestInfo, response: Response) => Promise<void>>();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("caches", {
      open: vi.fn<() => Promise<{ match: typeof match; put: typeof put }>>().mockResolvedValue({
        match,
        put,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn<() => string>(() => "blob:logo"),
    });

    await expect(resolveProviderLogo("anthropic-cache-hit")).resolves.toBe("blob:logo");
    await expect(resolveProviderLogo("anthropic-cache-hit")).resolves.toBe("blob:logo");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(match).toHaveBeenCalledTimes(1);
  });

  it("fetches once, stores in Cache API, then serves memory", async () => {
    const svg = new Blob(["<svg/>"], { type: "image/svg+xml" });
    const match = vi.fn<() => Promise<Response | undefined>>().mockResolvedValue(undefined);
    const put = vi
      .fn<(request: RequestInfo, response: Response) => Promise<void>>()
      .mockResolvedValue();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(svg, { status: 200 }));
    vi.stubGlobal("caches", {
      open: vi.fn<() => Promise<{ match: typeof match; put: typeof put }>>().mockResolvedValue({
        match,
        put,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn<() => string>(() => "blob:fetched"),
    });

    await expect(resolveProviderLogo("anthropic-fetch")).resolves.toBe("blob:fetched");
    await expect(resolveProviderLogo("anthropic-fetch")).resolves.toBe("blob:fetched");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
