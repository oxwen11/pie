import anthropic from "./logos/anthropic.svg?url";
import azureai from "./logos/azureai.svg?url";
import baseten from "./logos/baseten.svg?url";
import bedrock from "./logos/bedrock.svg?url";
import cerebras from "./logos/cerebras.svg?url";
import cloudflare from "./logos/cloudflare.svg?url";
import codex from "./logos/codex.svg?url";
import deepseek from "./logos/deepseek.svg?url";
import fireworks from "./logos/fireworks.svg?url";
import githubcopilot from "./logos/githubcopilot.svg?url";
import google from "./logos/google.svg?url";
import groq from "./logos/groq.svg?url";
import huggingface from "./logos/huggingface.svg?url";
import kimi from "./logos/kimi.svg?url";
import minimax from "./logos/minimax.svg?url";
import mistral from "./logos/mistral.svg?url";
import moonshot from "./logos/moonshot.svg?url";
import nvidia from "./logos/nvidia.svg?url";
import openai from "./logos/openai.svg?url";
import opencode from "./logos/opencode.svg?url";
import openrouter from "./logos/openrouter.svg?url";
import qwen from "./logos/qwen.svg?url";
import together from "./logos/together.svg?url";
import vercel from "./logos/vercel.svg?url";
import vertexai from "./logos/vertexai.svg?url";
import xai from "./logos/xai.svg?url";
import xiaomimimo from "./logos/xiaomimimo.svg?url";
import zai from "./logos/zai.svg?url";

/** @lobehub/icons-static-svg@1.95.0, keyed by lobehub slug. */
const LOGOS: Record<string, string> = {
  anthropic,
  azureai,
  baseten,
  bedrock,
  cerebras,
  cloudflare,
  codex,
  deepseek,
  fireworks,
  githubcopilot,
  google,
  groq,
  huggingface,
  kimi,
  minimax,
  mistral,
  moonshot,
  nvidia,
  openai,
  opencode,
  openrouter,
  qwen,
  together,
  vercel,
  vertexai,
  xai,
  xiaomimimo,
  zai,
};

const ALIASES: Record<string, string> = {
  "amazon-bedrock": "bedrock",
  "azure-openai-responses": "azureai",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  "github-copilot": "githubcopilot",
  "google-vertex": "vertexai",
  "kimi-coding": "kimi",
  "minimax-cn": "minimax",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  "openai-codex": "codex",
  "opencode-go": "opencode",
  "qwen-token-plan": "qwen",
  "qwen-token-plan-cn": "qwen",
  "qwen-token-plan-individual": "qwen",
  "vercel-ai-gateway": "vercel",
  xiaomi: "xiaomimimo",
  "xiaomi-token-plan-ams": "xiaomimimo",
  "xiaomi-token-plan-cn": "xiaomimimo",
  "xiaomi-token-plan-sgp": "xiaomimimo",
  "zai-coding-cn": "zai",
};

export function providerLogoSrc(provider: string): string | undefined {
  return LOGOS[ALIASES[provider] ?? provider];
}
