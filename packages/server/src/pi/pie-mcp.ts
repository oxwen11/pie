import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import type { SessionRef } from "@getpie/contract";

import { tokensMatch } from "../http/auth";

const ASAR_SEGMENT = `${path.sep}app.asar${path.sep}`;
const ASAR_UNPACKED_SEGMENT = `${path.sep}app.asar.unpacked${path.sep}`;

const asarUnpackedPath = (filePath: string): string => {
  const index = filePath.indexOf(ASAR_SEGMENT);
  if (index === -1) return filePath;
  return (
    filePath.slice(0, index) + ASAR_UNPACKED_SEGMENT + filePath.slice(index + ASAR_SEGMENT.length)
  );
};

const existingFile = (pathname: string): string | undefined => {
  try {
    return fs.existsSync(pathname) ? pathname : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Absolute path of the static Pie MCP extension. Prefer the copy shipped beside
 * pie-pi-process: Bun cannot read a file inside app.asar.
 */
export function pieMcpExtensionPath(piProcessEntry?: string): string | undefined {
  if (piProcessEntry !== undefined) {
    const beside = existingFile(
      asarUnpackedPath(path.join(path.dirname(piProcessEntry), "pie-mcp-extension.js")),
    );
    if (beside !== undefined) return beside;
  }
  return existingFile(
    asarUnpackedPath(url.fileURLToPath(new URL("./pie-mcp-extension.js", import.meta.url))),
  );
}

interface EndpointState {
  endpoint?: string;
}
const state: EndpointState = {};
/** Per-process bearers, each bound to the Session whose Pi child holds it. */
const issued = new Map<string, SessionRef>();

export function setAgentMcpEndpoint(next: string | undefined): void {
  state.endpoint = next;
}

export function agentMcpEndpoint(): string | undefined {
  return state.endpoint;
}

/** Loopback URL the Pi process can dial. An unspecified bind is not a Host. */
export function agentMcpListenUrl(host: string, port: number): string {
  const trimmed = host.trim();
  const connectHost =
    trimmed === "0.0.0.0" || trimmed === "::" || trimmed === "[::]" ? "127.0.0.1" : trimmed;
  const formatted =
    connectHost.includes(":") && !connectHost.startsWith("[") ? `[${connectHost}]` : connectHost;
  return `http://${formatted}:${port}/mcp`;
}

export function issueAgentMcpToken(ref: SessionRef): string {
  const token = crypto.randomBytes(32).toString("base64url");
  issued.set(token, { projectId: ref.projectId, sessionId: ref.sessionId });
  return token;
}

export function revokeAgentMcpToken(token: string): void {
  issued.delete(token);
}

/** The Session a per-process bearer is bound to, or undefined if it is not one. */
export function agentMcpSession(actual: string | null): SessionRef | undefined {
  if (actual === null) return undefined;
  let session: SessionRef | undefined;
  for (const [token, ref] of issued) {
    if (tokensMatch(token, actual)) session = ref;
  }
  return session;
}
