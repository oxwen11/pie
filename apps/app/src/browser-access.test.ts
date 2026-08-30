import { describe, expect, it, vi } from "vitest";

import { resolveBrowserAccess, type BrowserAccessEnvironment } from "./browser-access";

function environment(
  href: string,
  fetcher: BrowserAccessEnvironment["fetch"],
  replacements: string[],
): BrowserAccessEnvironment {
  return {
    location: { href },
    history: {
      replaceState: (_data, _unused, url) => {
        replacements.push(String(url));
      },
    },
    fetch: fetcher,
  };
}

describe("resolveBrowserAccess", () => {
  it("removes the fragment before exchanging its one-time grant", async () => {
    const events: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      events.push("fetch");
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("same-origin");
      return Response.json({ authenticated: true }, { status: 200 });
    });
    const accessEnvironment = environment(
      "http://127.0.0.1:4000/pair#grant=one-time-value",
      fetcher,
      events,
    );

    await expect(resolveBrowserAccess(accessEnvironment)).resolves.toEqual({
      status: "authenticated",
    });
    expect(events).toEqual(["/pair", "fetch", "/"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects and removes a query-string grant instead of exchanging it", async () => {
    const replacements: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      expect(input).toBe("/api/auth/session");
      return Response.json({ authenticated: false }, { status: 200 });
    });

    await expect(
      resolveBrowserAccess(
        environment("http://127.0.0.1:4000/pair?grant=query-value&keep=yes", fetcher, replacements),
      ),
    ).resolves.toEqual({ status: "pairing-required" });
    expect(replacements).toEqual(["/pair?keep=yes"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("mounts directly with an existing browser session and normalizes /pair", async () => {
    const replacements: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ authenticated: true }, { status: 200 }),
    );

    await expect(
      resolveBrowserAccess(environment("http://127.0.0.1:4000/pair", fetcher, replacements)),
    ).resolves.toEqual({ status: "authenticated" });
    expect(replacements).toEqual(["/"]);
  });

  it("shows the same safe failure for an expired or replayed grant", async () => {
    const replacements: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async () => new Response("Unauthorized", { status: 401 }));

    await expect(
      resolveBrowserAccess(
        environment("http://127.0.0.1:4000/pair#grant=expired-value", fetcher, replacements),
      ),
    ).resolves.toEqual({ status: "pairing-failed" });
    expect(replacements).toEqual(["/pair"]);
  });
});
