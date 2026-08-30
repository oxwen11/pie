import { describe, expect, it } from "vitest";

import {
  BROWSER_SESSION_COOKIE,
  BROWSER_SESSION_TTL_MS,
  createAccessAuthority,
  PAIRING_GRANT_TTL_MS,
  WEBSOCKET_TICKET_TTL_MS,
} from "../../src/http/access";

const master = { kind: "master" } as const;

function deterministicAuthority(now: () => number) {
  let next = 0;
  return createAccessAuthority({
    masterToken: "master-token",
    now,
    randomSecret: () => `secret-${++next}`,
  });
}

function issueBrowserSession(authority: ReturnType<typeof deterministicAuthority>) {
  const issuedGrant = authority.issuePairingGrant(master)!;
  const session = authority.exchangePairingGrant(issuedGrant.grant)!;
  const cookie = `${BROWSER_SESSION_COOKIE}=${session.cookieValue}`;
  const principal = authority.authenticateHttp({ authorization: undefined, cookie });
  expect(principal?.kind).toBe("browser");
  return { cookie, principal: principal! };
}

describe("AccessAuthority pairing grants", () => {
  it("uses 32 random bytes encoded as an opaque URL-safe value", () => {
    const authority = createAccessAuthority({ masterToken: "master-token" });
    const first = authority.issuePairingGrant(master)!;
    const second = authority.issuePairingGrant(master)!;
    expect(first.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.grant).not.toBe(second.grant);
  });

  it("is single-use and rejects replay", () => {
    const authority = deterministicAuthority(Date.now);
    const issued = authority.issuePairingGrant(master)!;
    expect(authority.exchangePairingGrant(issued.grant)).not.toBeNull();
    expect(authority.exchangePairingGrant(issued.grant)).toBeNull();
  });

  it("rejects an expired grant with the same result as an unknown grant", () => {
    let now = 1_000;
    const authority = deterministicAuthority(() => now);
    const issued = authority.issuePairingGrant(master)!;
    now += PAIRING_GRANT_TTL_MS + 1;
    expect(authority.exchangePairingGrant(issued.grant)).toBeNull();
    expect(authority.exchangePairingGrant("unknown")).toBeNull();
  });

  it("does not let a browser principal mint another pairing grant", () => {
    const authority = deterministicAuthority(Date.now);
    const { principal } = issueBrowserSession(authority);
    expect(authority.issuePairingGrant(principal)).toBeNull();
  });
});

describe("AccessAuthority browser sessions", () => {
  it("keeps explicit tokenless foreground serve compatible with the browser UI", () => {
    const authority = createAccessAuthority({ masterToken: undefined });
    expect(authority.inspectBrowserSession(undefined)).toEqual({ authenticated: true });
  });

  it("authenticates the HttpOnly cookie value without accepting unrelated cookies", () => {
    const authority = deterministicAuthority(Date.now);
    const { cookie } = issueBrowserSession(authority);
    expect(authority.inspectBrowserSession(`other=x; ${cookie}`).authenticated).toBe(true);
    expect(authority.inspectBrowserSession("other=x").authenticated).toBe(false);
  });

  it("expires browser sessions", () => {
    let now = 1_000;
    const authority = deterministicAuthority(() => now);
    const { cookie } = issueBrowserSession(authority);
    now += BROWSER_SESSION_TTL_MS + 1;
    expect(authority.inspectBrowserSession(cookie).authenticated).toBe(false);
    expect(authority.authenticateHttp({ authorization: undefined, cookie })).toBeNull();
  });

  it("prefers a valid master bearer over a browser cookie", () => {
    const authority = deterministicAuthority(Date.now);
    const { cookie } = issueBrowserSession(authority);
    expect(authority.authenticateHttp({ authorization: "Bearer master-token", cookie })).toEqual(
      master,
    );
  });
});

describe("AccessAuthority WebSocket tickets", () => {
  it("issues single-use tickets for master and browser principals", () => {
    const authority = deterministicAuthority(Date.now);
    const { principal } = issueBrowserSession(authority);
    const masterTicket = authority.issueWebSocketTicket(master);
    const browserTicket = authority.issueWebSocketTicket(principal);
    expect(authority.consumeWebSocketTicket(masterTicket)).toEqual(master);
    expect(authority.consumeWebSocketTicket(browserTicket)).toEqual(principal);
    expect(authority.consumeWebSocketTicket(masterTicket)).toBeNull();
    expect(authority.consumeWebSocketTicket(browserTicket)).toBeNull();
  });

  it("rejects an expired ticket", () => {
    let now = 1_000;
    const authority = deterministicAuthority(() => now);
    const ticket = authority.issueWebSocketTicket(master);
    now += WEBSOCKET_TICKET_TTL_MS + 1;
    expect(authority.consumeWebSocketTicket(ticket)).toBeNull();
  });

  it("invalidates a browser ticket when its parent session expires", () => {
    let now = 1_000;
    const authority = deterministicAuthority(() => now);
    const { principal } = issueBrowserSession(authority);
    const ticket = authority.issueWebSocketTicket(principal);
    now += BROWSER_SESSION_TTL_MS + 1;
    expect(authority.consumeWebSocketTicket(ticket)).toBeNull();
  });
});
