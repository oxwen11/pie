import crypto from "node:crypto";

import { bearerToken, tokensMatch } from "./auth";

export const PAIRING_GRANT_TTL_MS = 60_000;
export const BROWSER_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
export const WEBSOCKET_TICKET_TTL_MS = 10_000;
export const BROWSER_SESSION_COOKIE = "pie_session";

export type AccessPrincipal =
  | { readonly kind: "master" }
  | { readonly kind: "browser"; readonly sessionId: string };

export type IssuedPairingGrant = {
  readonly grant: string;
  readonly expiresInSeconds: number;
};

export type IssuedBrowserSession = {
  readonly cookieValue: string;
  readonly maxAgeSeconds: number;
};

export type AccessAuthority = {
  authenticateHttp(input: {
    readonly authorization: string | undefined;
    readonly cookie: string | undefined;
  }): AccessPrincipal | null;
  issuePairingGrant(principal: AccessPrincipal): IssuedPairingGrant | null;
  exchangePairingGrant(grant: string): IssuedBrowserSession | null;
  inspectBrowserSession(cookie: string | undefined): { readonly authenticated: boolean };
  issueWebSocketTicket(principal: AccessPrincipal): string;
  consumeWebSocketTicket(ticket: string | null): AccessPrincipal | null;
};

type Expiring<T> = T & { readonly expiresAt: number };

type AccessAuthorityOptions = {
  readonly masterToken: string | undefined;
  readonly now?: () => number;
  readonly randomSecret?: () => string;
};

function defaultRandomSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function cookieValue(cookie: string | undefined, name: string): string | undefined {
  if (cookie === undefined) return undefined;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function createAccessAuthority(options: AccessAuthorityOptions): AccessAuthority {
  const now = options.now ?? Date.now;
  const randomSecret = options.randomSecret ?? defaultRandomSecret;
  const pairingGrants = new Map<string, number>();
  const browserSessions = new Map<string, Expiring<{ readonly sessionId: string }>>();
  const sessionExpiries = new Map<string, number>();
  const webSocketTickets = new Map<string, Expiring<{ readonly principal: AccessPrincipal }>>();

  const removeExpired = () => {
    const current = now();
    for (const [grant, expiresAt] of pairingGrants) {
      if (expiresAt <= current) pairingGrants.delete(grant);
    }
    for (const [value, session] of browserSessions) {
      if (session.expiresAt <= current) {
        browserSessions.delete(value);
        sessionExpiries.delete(session.sessionId);
      }
    }
    for (const [ticket, record] of webSocketTickets) {
      if (record.expiresAt <= current) webSocketTickets.delete(ticket);
    }
  };

  const browserPrincipal = (cookie: string | undefined): AccessPrincipal | null => {
    const value = cookieValue(cookie, BROWSER_SESSION_COOKIE);
    if (value === undefined) return null;
    const session = browserSessions.get(value);
    if (session === undefined || session.expiresAt <= now()) {
      browserSessions.delete(value);
      if (session !== undefined) sessionExpiries.delete(session.sessionId);
      return null;
    }
    return { kind: "browser", sessionId: session.sessionId };
  };

  return {
    authenticateHttp(input) {
      removeExpired();
      if (
        options.masterToken === undefined ||
        tokensMatch(options.masterToken, bearerToken(input.authorization))
      ) {
        return { kind: "master" };
      }
      return browserPrincipal(input.cookie);
    },

    issuePairingGrant(principal) {
      removeExpired();
      if (principal.kind !== "master") return null;
      const grant = randomSecret();
      pairingGrants.set(grant, now() + PAIRING_GRANT_TTL_MS);
      return { grant, expiresInSeconds: PAIRING_GRANT_TTL_MS / 1_000 };
    },

    exchangePairingGrant(grant) {
      removeExpired();
      const expiresAt = pairingGrants.get(grant);
      if (expiresAt === undefined) return null;
      pairingGrants.delete(grant);
      if (expiresAt <= now()) return null;

      const sessionId = randomSecret();
      const value = randomSecret();
      const sessionExpiresAt = now() + BROWSER_SESSION_TTL_MS;
      browserSessions.set(value, { sessionId, expiresAt: sessionExpiresAt });
      sessionExpiries.set(sessionId, sessionExpiresAt);
      return { cookieValue: value, maxAgeSeconds: BROWSER_SESSION_TTL_MS / 1_000 };
    },

    inspectBrowserSession(cookie) {
      removeExpired();
      return { authenticated: browserPrincipal(cookie) !== null };
    },

    issueWebSocketTicket(principal) {
      removeExpired();
      const ticket = randomSecret();
      webSocketTickets.set(ticket, {
        principal,
        expiresAt: now() + WEBSOCKET_TICKET_TTL_MS,
      });
      return ticket;
    },

    consumeWebSocketTicket(ticket) {
      removeExpired();
      if (ticket === null) return null;
      const record = webSocketTickets.get(ticket);
      if (record === undefined) return null;
      webSocketTickets.delete(ticket);
      if (record.expiresAt <= now()) return null;
      if (
        record.principal.kind === "browser" &&
        (sessionExpiries.get(record.principal.sessionId) ?? 0) <= now()
      ) {
        return null;
      }
      return record.principal;
    },
  };
}
