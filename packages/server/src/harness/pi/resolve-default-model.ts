import type { AgentSessionServices } from "@earendil-works/pi-coding-agent";
import type { AgentModel } from "@pie/contract";

import { toAgentModel } from "./model-mapping";

/**
 * Default model IDs per provider — kept in sync with Pi's `defaultModelPerProvider`
 * (`pi-coding-agent` `core/model-resolver.ts`) for draft picker defaults.
 */
const defaultModelPerProvider: Readonly<Record<string, string>> = {
  "amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
  "ant-ling": "Ring-2.6-1T",
  anthropic: "claude-opus-4-8",
  openai: "gpt-5.5",
  "azure-openai-responses": "gpt-5.4",
  "openai-codex": "gpt-5.5",
  radius: "auto",
  nvidia: "nvidia/nemotron-3-super-120b-a12b",
  deepseek: "deepseek-v4-pro",
  google: "gemini-3.1-pro-preview",
  "google-vertex": "gemini-3.1-pro-preview",
  "github-copilot": "gpt-5.4",
  openrouter: "moonshotai/kimi-k2.6",
  "vercel-ai-gateway": "zai/glm-5.1",
  xai: "grok-4.5",
  groq: "openai/gpt-oss-120b",
  cerebras: "zai-glm-4.7",
  zai: "glm-5.1",
  "zai-coding-cn": "glm-5.1",
  mistral: "devstral-medium-latest",
  minimax: "MiniMax-M2.7",
  "minimax-cn": "MiniMax-M2.7",
  moonshotai: "kimi-k2.6",
  "moonshotai-cn": "kimi-k2.6",
  huggingface: "moonshotai/Kimi-K2.6",
  fireworks: "accounts/fireworks/models/kimi-k2p6",
  together: "moonshotai/Kimi-K2.6",
  opencode: "kimi-k2.6",
  "opencode-go": "kimi-k2.6",
  "kimi-coding": "kimi-for-coding",
  "cloudflare-workers-ai": "@cf/moonshotai/kimi-k2.6",
  "cloudflare-ai-gateway": "workers-ai/@cf/moonshotai/kimi-k2.6",
  xiaomi: "mimo-v2.5-pro",
  "xiaomi-token-plan-cn": "mimo-v2.5-pro",
  "xiaomi-token-plan-ams": "mimo-v2.5-pro",
  "xiaomi-token-plan-sgp": "mimo-v2.5-pro",
};

/** Mirrors Pi `findInitialModel` for a fresh session (no CLI args, no scoped models). */
export async function resolveDefaultPiModel(
  services: AgentSessionServices,
): Promise<AgentModel | undefined> {
  const { settingsManager, modelRuntime } = services;
  const defaultProvider = settingsManager.getDefaultProvider();
  const defaultModelId = settingsManager.getDefaultModel();
  if (defaultProvider && defaultModelId) {
    const found = modelRuntime.getModel(defaultProvider, defaultModelId);
    if (found && modelRuntime.hasConfiguredAuth(found.provider)) {
      return toAgentModel(found);
    }
  }

  const availableModels = [...(await modelRuntime.getAvailable())];
  if (availableModels.length === 0) return undefined;

  for (const provider of Object.keys(defaultModelPerProvider)) {
    const defaultId = defaultModelPerProvider[provider];
    const match = availableModels.find((m) => m.provider === provider && m.id === defaultId);
    if (match) return toAgentModel(match);
  }

  return toAgentModel(availableModels[0]!);
}
