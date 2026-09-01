import http from "node:http";
import https from "node:https";

export type FetchResult = {
  status: number;
  body: string;
};

/**
 * Loopback HTTP via `node:http`. Global `fetch` is intercepted in some agent
 * runtimes (`bad port` on Vite 4190) even when the listener is healthy.
 */
export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 2000,
): Promise<FetchResult | undefined> {
  try {
    return await nodeRequest(url, init, timeoutMs);
  } catch {
    return undefined;
  }
}

function nodeRequest(url: string, init: RequestInit, timeoutMs: number): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? "GET",
        headers: requestHeaders(init.headers),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout ${url}`));
    });
    req.end();
  });
}

function requestHeaders(headers: RequestInit["headers"]): http.OutgoingHttpHeaders | undefined {
  if (headers === undefined) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

export function loopbackOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
}

export function healthUrls(target: string | number): string[] {
  if (typeof target === "number") {
    return loopbackOrigins(target).map((origin) => `${origin}/api/health`);
  }
  return [`${stripSlash(target)}/api/health`];
}

export async function healthOk(target: string | number): Promise<boolean> {
  for (const url of healthUrls(target)) {
    const result = await fetchText(url);
    if (result?.body === "ok") {
      return true;
    }
  }
  return false;
}

export async function ticketStatus(address: string, token?: string): Promise<number | undefined> {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  const result = await fetchText(`${stripSlash(address)}/api/ws-ticket`, {
    method: "POST",
    headers,
  });
  return result?.status;
}

/** Node fetch of `http://localhost` can miss an IPv6-only listener (Vite 4190). */
export async function ticketStatusOnPort(
  port: number,
  token?: string,
): Promise<number | undefined> {
  for (const origin of loopbackOrigins(port)) {
    const status = await ticketStatus(origin, token);
    if (status !== undefined) {
      return status;
    }
  }
  return undefined;
}

export async function cdpOk(port: number): Promise<boolean> {
  const result = await fetchText(`http://127.0.0.1:${port}/json/version`);
  return result?.status === 200;
}

export async function warmupOrigin(port: number, timeoutMs = 10_000): Promise<void> {
  for (const origin of loopbackOrigins(port)) {
    const result = await fetchText(`${origin}/`, {}, timeoutMs);
    if (result !== undefined) {
      return;
    }
  }
}

export function urlPort(address: string): number {
  const port = Number(new URL(address).port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`no port in ${address}`);
  }
  return port;
}

function stripSlash(address: string): string {
  return address.replace(/\/$/, "");
}
