export type FetchResult = {
  status: number;
  body: string;
};

export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 2000): Promise<FetchResult | undefined> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, body: await response.text() };
  } catch {
    return undefined;
  }
}

export async function healthOk(target: string | number): Promise<boolean> {
  const urls =
    typeof target === "number"
      ? [`http://127.0.0.1:${target}/api/health`, `http://localhost:${target}/api/health`]
      : [`${stripSlash(target)}/api/health`];
  for (const url of urls) {
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
  const result = await fetchText(`${stripSlash(address)}/api/ws-ticket`, { method: "POST", headers });
  return result?.status;
}

export async function cdpOk(port: number): Promise<boolean> {
  const result = await fetchText(`http://127.0.0.1:${port}/json/version`);
  return result?.status === 200;
}

export async function cdpVersion(port: number): Promise<string | undefined> {
  const result = await fetchText(`http://127.0.0.1:${port}/json/version`);
  return result?.body;
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
