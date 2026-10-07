// A registered Project is trusted for declarative Pi resources.
export const PI_PROJECT_SETTINGS_OPTIONS = { projectTrusted: true } as const;

// pie-pi-process children load Pi's built-in and the user's extensions
// (MCP, codemode, tool_search, custom providers and commands). The daemon
// never runs extension code; command and model listing use a short-lived child.
export const PI_PROJECT_PROCESS_ARGS = ["--approve"] as const;
