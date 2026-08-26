import { readTailscaleStatus } from "@getpie/tailscale";
import { Effect } from "effect";

export function mergePieAllowedHosts(
  env: NodeJS.ProcessEnv,
  extraHosts: readonly string[],
): NodeJS.ProcessEnv {
  if (extraHosts.length === 0) return env;
  const existing = (env["PIE_ALLOWED_HOSTS"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const seen = new Set(existing.map((entry) => entry.toLowerCase()));
  const merged = [...existing];
  for (const host of extraHosts) {
    const trimmed = host.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  if (merged.length === existing.length) return env;
  return { ...env, PIE_ALLOWED_HOSTS: merged.join(",") };
}

/** Add this machine's MagicDNS name to CORS when Tailscale is up. Failures are ignored. */
export const withTailscaleAllowedHosts = (env: NodeJS.ProcessEnv) =>
  readTailscaleStatus.pipe(
    Effect.map((status) =>
      mergePieAllowedHosts(env, status.magicDnsName === null ? [] : [status.magicDnsName]),
    ),
    Effect.orElseSucceed(() => env),
  );
