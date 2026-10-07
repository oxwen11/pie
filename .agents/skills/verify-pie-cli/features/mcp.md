# MCP

`/mcp` is on the same daemon as the CLI. Protocol for this proof is `2025-11-25` via `initialize`. `pie mcp` prints the URL and a derived bearer. That bearer is not the daemon token and must not be written into evidence or chat.

## How to get to it

Same isolated daemon as [session-commands.md](session-commands.md). `pie serve` has nothing to derive a token from. Do not use it.

## Driving it

```bash
pnpm exec pie-verify cli run mcp --json
```

Read `url` and `token` in the shell. Do not print the token.

```bash
curl -s "$URL" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"verify","version":"0"}}}'
```

Then `tools/list`, then `tools/call` `session_ls` with the project id from `pie project create`.

Every MCP request uses the bearer from `pie mcp`. Do not probe `/mcp` without it.

Proof:

- `initialize` result `protocolVersion` is `2025-11-25`.
- `tools/list` includes `session_ls`, `session_run`, `session_send`, `session_logs`, `schedule_run`, `project_ls`, `pr_ls`.
- `pr_ls` is the session association, not `pullRequest.list`.
- `tools/list` does not include `session_rm`, `session_respond`, or any tool whose name contains `respond`.
- `session_ls` returns the session `pie run` created. Same daemon, same id as `pie ls`.
