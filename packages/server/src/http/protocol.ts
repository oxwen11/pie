export const PIE_HTTP_PROTOCOL_VERSION = 2;
export const BROWSER_ACCESS_MIN_PROTOCOL_VERSION = 2;
export const PIE_PROTOCOL_HEADER = "x-pie-protocol-version";

export function parseProtocolVersion(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || !/^\d+$/.test(value)) return undefined;
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : undefined;
}
