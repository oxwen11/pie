/**
 * E2E-only Pi extension: registers a provider whose streamSimple never
 * leaves the process. Seeded under `$PI_CODING_AGENT_DIR/extensions/`.
 *
 * Prompt text containing `e2e-hold` keeps the stream open until abort or
 * 30s — used by Stop / Queue / Steer e2e.
 */
import {
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  calculateCost,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const E2E_PROVIDER = "e2e";
export const E2E_MODEL = "fake";
export const E2E_HOLD_MARKER = "e2e-hold";

const reply = () => process.env["PIE_E2E_PI_RESPONSE"] ?? "E2E fake Pi reply";

/** How long an `e2e-hold` stream stays open before finishing. */
const HOLD_MS = 30_000;

function latestUserText(context: Context): string {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) return "";
    return message.content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("");
  }
  return "";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function streamFake(model: Model<string>, context: Context, options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();

  void (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "pending",
      timestamp: Date.now(),
    };

    try {
      stream.push({ type: "start", partial: output });

      if (latestUserText(context).includes(E2E_HOLD_MARKER)) {
        await sleep(HOLD_MS, options?.signal);
      }

      const text = reply();
      output.content.push({ type: "text", text: "" });
      const contentIndex = output.content.length - 1;
      stream.push({ type: "text_start", contentIndex, partial: output });

      const block = output.content[contentIndex];
      if (block?.type === "text") block.text = text;
      stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
      stream.push({ type: "text_end", contentIndex, content: text, partial: output });

      output.stopReason = "stop";
      output.usage.output = 1;
      output.usage.totalTokens = 1;
      calculateCost(model, output.usage);

      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

export default function e2eProvider(pi: ExtensionAPI) {
  pi.registerProvider(E2E_PROVIDER, {
    baseUrl: "http://127.0.0.1:0",
    apiKey: "e2e",
    api: "e2e-fake-api",
    models: [
      {
        id: E2E_MODEL,
        name: "E2E Fake",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4096,
      },
    ],
    streamSimple: streamFake,
  });
}
