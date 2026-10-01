// Registered Projects are trusted for Pi resources, including extensions.
// User extensions and configured packages also supply providers and commands.
// Cold discovery skips terminal themes/context, not executable extensions.
export const PI_PROJECT_SETTINGS_OPTIONS = { projectTrusted: true } as const;

export const PI_PROJECT_LOADER_OPTIONS = {
  noThemes: true,
  noContextFiles: true,
} as const;

export const PI_PROJECT_PROCESS_ARGS = ["--approve"] as const;
