// A registered Project is trusted for declarative Pi resources.
export const PI_PROJECT_SETTINGS_OPTIONS = { projectTrusted: true } as const;

// Model listing loads Pi inside the daemon. Extensions must run so they can
// register providers (for example pi-cursor) before getAvailable().
export const PI_PROJECT_LOADER_OPTIONS = {
  noThemes: true,
  noContextFiles: true,
} as const;

// pie-pi-process children load Pi's built-in and the user's extensions
// (MCP, codemode, tool_search, custom providers and commands).
export const PI_PROJECT_PROCESS_ARGS = ["--approve"] as const;
