/**
 * Seed an isolated Pi agent dir for e2e: fake provider extension + default
 * model. Nest under `$PIE_HOME/agent` and point `PI_CODING_AGENT_DIR` at it
 * — Pi discovers `extensions/` from the agent dir, not from `$PIE_HOME`.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = import.meta.dirname;

const E2E_PROVIDER = "e2e";
const E2E_MODEL = "fake";
export const DEFAULT_E2E_REPLY = "E2E fake Pi reply";

/** `$PIE_HOME/agent` — one cleanup root with the pie home. */
function e2eAgentDir(pieHome: string): string {
  return path.join(pieHome, "agent");
}

/**
 * Empty isolated agent dir — keeps e2e off `~/.pi/agent` without seeding a
 * provider. Use when the test never needs a model reply.
 */
export function e2eIsolatedAgentEnv(pieHome: string) {
  const agentDir = e2eAgentDir(pieHome);
  fs.mkdirSync(agentDir, { recursive: true });
  return { PI_CODING_AGENT_DIR: agentDir };
}

export type SeedE2ePiAgentOptions = {
  readonly reply?: string;
};

/**
 * Write extension + settings + auth into `agentDir`.
 */
function seedE2ePiAgent(agentDir: string, options: SeedE2ePiAgentOptions = {}) {
  const extensions = path.join(agentDir, "extensions");
  fs.mkdirSync(extensions, { recursive: true });
  fs.copyFileSync(
    path.join(here, "fake-e2e-provider.ts"),
    path.join(extensions, "fake-e2e-provider.ts"),
  );

  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        defaultProvider: E2E_PROVIDER,
        defaultModel: E2E_MODEL,
        defaultProjectTrust: "always",
      },
      null,
      2,
    )}\n`,
  );

  // Provider config already has apiKey: "e2e"; auth.json makes /model treat it
  // as available the same way a logged-in provider would.
  fs.writeFileSync(
    path.join(agentDir, "auth.json"),
    `${JSON.stringify({ [E2E_PROVIDER]: { type: "api_key", key: "e2e" } }, null, 2)}\n`,
  );

  return {
    agentDir,
    reply: options.reply ?? DEFAULT_E2E_REPLY,
  };
}

/**
 * Env overlay for conversation e2e only: seed the fake provider so a real
 * pie-pi-process can answer without an API key. Do not use on connect /
 * daemon / MessagePort tests — those should never need a model turn.
 * Does not set `PIE_E2E_PI_EXECUTABLE`.
 */
export function e2ePiProcessEnv(pieHome: string, options: SeedE2ePiAgentOptions = {}) {
  const seeded = seedE2ePiAgent(e2eAgentDir(pieHome), options);
  return {
    PI_CODING_AGENT_DIR: seeded.agentDir,
    PIE_E2E_PI_RESPONSE: seeded.reply,
  };
}
