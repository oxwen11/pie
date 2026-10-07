const GUIDANCE = [
  "Pie pull request tracking (MCP server `pie`):",
  "- Call `pr_link` immediately after you create a pull request, and when you begin actual work on or review of an existing one. Pass `pullRequest` as {host, owner, repository, number}; omit `ref`, it is this session.",
  "- For a stack, link each known member separately. Do not link PRs that are only mentioned in passing, and do not infer a stack.",
  "- A failed `pr_link` is separate from the PR having been created on GitHub: report the failure.",
  "- Before you finish, call `pr_ls` and link anything you missed. Never pass `restore` unless the user explicitly asks; an excluded PR stays excluded.",
].join("\n");

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
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${GUIDANCE}`,
  }));
}
