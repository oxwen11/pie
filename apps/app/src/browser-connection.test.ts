import { describe, expect, it, vi } from "vitest";

import { issueBrowserWebSocketTicket } from "./browser-connection";

describe("issueBrowserWebSocketTicket", () => {
  it("uses the HttpOnly browser session on every ticket request", async () => {
    let issued = 0;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      issued += 1;
      expect(init).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      return Response.json({ ticket: `ticket-${issued}` }, { status: 200 });
    });

    await expect(issueBrowserWebSocketTicket(fetcher)).resolves.not.toBe(
      await issueBrowserWebSocketTicket(fetcher),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not include a refused response body in its error", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response("sensitive-response-marker", { status: 401 }),
    );
    const error = await issueBrowserWebSocketTicket(fetcher).catch((cause: unknown) => cause);
    expect(String(error)).not.toContain("sensitive-response-marker");
  });
});
