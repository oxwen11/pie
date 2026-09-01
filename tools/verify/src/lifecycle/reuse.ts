export type ExistingKind = "absent" | "reuse" | "live" | "stale";

export function classifyExisting(input: {
  healthy: boolean;
  live: boolean;
}): Exclude<ExistingKind, "absent"> {
  if (input.healthy) {
    return "reuse";
  }
  if (input.live) {
    return "live";
  }
  return "stale";
}
