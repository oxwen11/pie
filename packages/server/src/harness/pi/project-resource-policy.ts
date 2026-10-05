// A registered Project is trusted for declarative Pi resources.
export const PI_PROJECT_SETTINGS_OPTIONS = { projectTrusted: true } as const;

// Model listing loads Pi inside the daemon, so it does not run extension code.
export const PI_PROJECT_LOADER_OPTIONS = {
  noExtensions: true,
  noThemes: true,
  noContextFiles: true,
} as const;

// pie-pi-process children load Pi's built-in and the user's extensions
// (MCP, codemode, tool_search, custom providers and commands).
export const PI_PROJECT_PROCESS_ARGS = ["--approve"] as const;
