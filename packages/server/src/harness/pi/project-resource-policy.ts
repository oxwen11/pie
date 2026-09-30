// A registered Project is trusted for declarative Pi resources, but Pie does
// not model extension-handled inputs that complete without a model turn.
// Keep cold discovery and live children on the same resource policy.
export const PI_PROJECT_SETTINGS_OPTIONS = { projectTrusted: true } as const;

export const PI_PROJECT_LOADER_OPTIONS = {
  noExtensions: true,
  noThemes: true,
  noContextFiles: true,
} as const;

export const PI_PROJECT_PROCESS_ARGS = ["--approve", "--no-extensions"] as const;
