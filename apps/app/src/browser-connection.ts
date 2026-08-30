export async function issueBrowserWebSocketTicket(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  const response = await fetcher("/api/ws-ticket", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to obtain browser WebSocket access: ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).ticket !== "string"
  ) {
    throw new Error("Failed to obtain browser WebSocket access: invalid response");
  }
  return (body as { readonly ticket: string }).ticket;
}
