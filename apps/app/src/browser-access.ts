export type BrowserAccessResult =
  | { readonly status: "authenticated" }
  | { readonly status: "pairing-required" }
  | { readonly status: "pairing-failed" };

export type BrowserAccessEnvironment = {
  readonly location: Pick<Location, "href">;
  readonly history: Pick<History, "replaceState">;
  readonly fetch: typeof globalThis.fetch;
};

function sanitizedPath(url: URL): string {
  const search = url.searchParams.size === 0 ? "" : `?${url.searchParams.toString()}`;
  return `${url.pathname}${search}`;
}

function fragmentGrant(url: URL): string | null {
  if (url.pathname !== "/pair" || url.hash.length <= 1) return null;
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.size !== 1) return null;
  const grant = fragment.get("grant");
  return grant === null || grant.length === 0 ? null : grant;
}

async function hasBrowserSession(environment: BrowserAccessEnvironment): Promise<boolean> {
  try {
    const fetcher = environment.fetch;
    const response = await fetcher("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return false;
    const body = (await response.json()) as unknown;
    return (
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>).authenticated === true
    );
  } catch {
    return false;
  }
}

async function exchangeGrant(
  environment: BrowserAccessEnvironment,
  grant: string,
): Promise<boolean> {
  try {
    const fetcher = environment.fetch;
    const response = await fetcher("/api/auth/browser-session", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Resolve browser authentication before the shared app runtime is constructed. */
export async function resolveBrowserAccess(
  environment?: BrowserAccessEnvironment,
): Promise<BrowserAccessResult> {
  const activeEnvironment = environment ?? {
    location: globalThis.location,
    history: globalThis.history,
    fetch: globalThis.fetch,
  };
  const url = new URL(activeEnvironment.location.href);
  const grant = fragmentGrant(url);

  const hadFragment = url.hash.length > 0;
  const hadQueryGrant = url.searchParams.has("grant");
  url.searchParams.delete("grant");
  url.hash = "";
  if (hadFragment || hadQueryGrant) {
    activeEnvironment.history.replaceState(null, "", sanitizedPath(url));
  }

  if (grant !== null) {
    if (!(await exchangeGrant(activeEnvironment, grant))) return { status: "pairing-failed" };
    activeEnvironment.history.replaceState(null, "", "/");
    return { status: "authenticated" };
  }

  if (!(await hasBrowserSession(activeEnvironment))) return { status: "pairing-required" };
  if (url.pathname === "/pair") activeEnvironment.history.replaceState(null, "", "/");
  return { status: "authenticated" };
}
