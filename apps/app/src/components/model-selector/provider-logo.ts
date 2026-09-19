/** models.dev hosts one SVG per provider id — Pi ids match. Desktop caches via Chromium HTTP disk cache (see models-dev-logo-cache). */
export function providerLogoSrc(provider: string): string {
  return `https://models.dev/logos/${encodeURIComponent(provider)}.svg`;
}
