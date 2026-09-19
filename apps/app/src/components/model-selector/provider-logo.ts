/** models.dev hosts one SVG per provider id — Pi ids match. */
export function providerLogoSrc(provider: string): string {
  return `https://models.dev/logos/${encodeURIComponent(provider)}.svg`;
}
