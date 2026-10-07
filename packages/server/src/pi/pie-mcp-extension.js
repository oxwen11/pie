/**
 * Registers the daemon MCP server. URL and bearer come from env; bash strips PIE_*.
 * @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi
 */
export default async function pieMcp(pi) {
  pi.on("session_before_switch", () => ({ cancel: true }));
  pi.on("session_before_fork", () => ({ cancel: true }));
  const url = process.env.PIE_MCP_URL;
  const token = process.env.PIE_MCP_TOKEN;
  if (!url || !token) return;
  pi.registerMcpServer("pie", {
    url,
    headers: { Authorization: `Bearer ${token}` },
    exposure: "direct",
  });
}
