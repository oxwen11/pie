/** Body of `GET /api/environment`. */
export function parseEnvironmentId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
