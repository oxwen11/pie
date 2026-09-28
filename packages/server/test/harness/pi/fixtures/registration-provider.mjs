// Deterministic provider; Pi still loads, validates and executes the real extension tools.
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function registrationProvider(pi) {
  if (process.env.PIE_AUTH_TOKEN) throw new Error("Daemon credentials reached Pi");
  // oxlint-disable-next-line unicorn/no-process-exit -- intentionally crash this isolated child to prove bridge cleanup
  pi.registerCommand("registration-crash", { handler: () => process.exit(7) });
  pi.registerProvider("registration-test", {
    baseUrl: "http://127.0.0.1:1",
    apiKey: "test-only",
    api: "registration-test",
    models: [
      {
        id: "model",
        name: "Registration test",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 4096,
      },
    ],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const last = context.messages.at(-1);
      const output = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "start", partial: output });
      if (last?.role === "user") {
        const text =
          typeof last.content === "string"
            ? last.content
            : last.content
                .filter((x) => x.type === "text")
                .map((x) => x.text)
                .join("");
        const input = JSON.parse(text);
        const call = {
          type: "toolCall",
          id: `call-${context.messages.length}`,
          name: input.tool,
          arguments: input.input,
        };
        output.content.push(call);
        output.stopReason = "toolUse";
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
        stream.push({
          type: "toolcall_delta",
          contentIndex: 0,
          delta: JSON.stringify(call.arguments),
          partial: output,
        });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: output });
      } else {
        output.content.push({ type: "text", text: "Tool completed" });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "Tool completed",
          partial: output,
        });
        stream.push({
          type: "text_end",
          contentIndex: 0,
          content: "Tool completed",
          partial: output,
        });
      }
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
      return stream;
    },
  });
}
