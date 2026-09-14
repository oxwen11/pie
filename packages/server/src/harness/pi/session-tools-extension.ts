/** Embedded so the single-file server bundle can materialize it for Pi's -e loader. */
export const sessionToolsExtension = String.raw`
import { Type } from "typebox";

export default async function sessionTools(pi) {
  const endpoint = process.env.PIE_SESSION_BRIDGE_URL;
  const token = process.env.PIE_SESSION_BRIDGE_TOKEN;
  if (!endpoint || !token) throw new Error("Session tools are unavailable");
  const shutdown = new AbortController();
  pi.on("session_shutdown", () => shutdown.abort());
  // A Pie runtime owns exactly one Pi session. Replacement must go through Pie.
  pi.on("session_before_switch", () => ({ cancel: true }));
  pi.on("session_before_fork", () => ({ cancel: true }));

  async function call(operation, input, signal) {
    const signals = [shutdown.signal, AbortSignal.timeout(30000)];
    if (signal) signals.push(signal);
    let response;
    try {
      response = await fetch(endpoint + "/" + operation, {
        method: "POST",
        headers: { "authorization": "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.any(signals),
        redirect: "error",
      });
    } catch {
      throw new Error("Session association request failed or was cancelled; success is unconfirmed. List associations before retrying.");
    }
    if (!response.ok) throw new Error("Session association request failed (" + response.status + "); no success was confirmed.");
    const data = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
  }

  pi.registerTool({
    name: "session_register_pull_request",
    label: "Register session PR",
    description: "Persist a known GitHub PR association for this session without querying GitHub. Returns linked, exists, or excluded. A valid identity is not a verified remote status. Restore an excluded link only when explicitly requested.",
    promptSnippet: "Immediately save a PR this session created or is actively modifying or reviewing",
    promptGuidelines: ["Use session_register_pull_request immediately after creating a PR or beginning actual work on an existing PR, for each known member separately. Do not register unrelated mentions or infer a Stack. Registration failure is separate from successful GitHub creation. Never restore exclusions automatically."],
    parameters: Type.Object({
      url: Type.String({ description: "Exact HTTPS GitHub pull request URL" }),
      restore: Type.Optional(Type.Boolean({ description: "Only true for an explicitly requested restoration" })),
    }, { additionalProperties: false }),
    execute: (_id, input, signal) => call("register", input, signal),
  });
  pi.registerTool({
    name: "session_list_pull_requests",
    label: "List session PRs",
    description: "Read this session's saved PR associations, including exclusions. Cache only; does not query GitHub. Returns up to 100 identities with exclusion flags and an omitted count.",
    promptSnippet: "List saved associations and exclusions for this session",
    promptGuidelines: ["Use session_list_pull_requests before finishing PR work to check for missing associations; respect exclusions."],
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: (_id, input, signal) => call("list", input, signal),
  });
  pi.registerTool({
    name: "session_exclude_pull_request",
    label: "Exclude session PR",
    description: "Persist an exclusion for a PR in this session. Does not close or change the GitHub PR. Automatic discovery and ordinary registration cannot restore an excluded link.",
    parameters: Type.Object({ url: Type.String({ description: "Exact HTTPS GitHub pull request URL" }) }, { additionalProperties: false }),
    execute: (_id, input, signal) => call("exclude", input, signal),
  });
  await call("ready", {}, undefined);
}
`;
