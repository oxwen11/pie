/** models.dev hosts one SVG per provider id — Pi ids match. */
export function providerLogoUrl(provider: string): string {
  return `https://models.dev/logos/${encodeURIComponent(provider)}.svg`;
}

const CACHE_NAME = "pie-provider-logos";
/** In-memory blob URLs (or null after a hard miss). Shared across mounts. */
const memory = new Map<string, string | null>();

function openLogoCache(): Promise<Cache> | undefined {
  if (typeof caches === "undefined") return undefined;
  return caches.open(CACHE_NAME);
}

/** Fetch once per provider, persist in Cache API, reuse a blob: URL. */
export async function resolveProviderLogo(provider: string): Promise<string | undefined> {
  if (memory.has(provider)) return memory.get(provider) ?? undefined;

  const url = providerLogoUrl(provider);
  try {
    const store = await openLogoCache();
    let response = store === undefined ? undefined : await store.match(url);
    if (response === undefined) {
      response = await fetch(url);
      if (!response.ok) {
        memory.set(provider, null);
        return undefined;
      }
      await store?.put(url, response.clone());
    }
    const blobUrl = URL.createObjectURL(await response.blob());
    memory.set(provider, blobUrl);
    return blobUrl;
  } catch {
    memory.set(provider, null);
    return undefined;
  }
}
