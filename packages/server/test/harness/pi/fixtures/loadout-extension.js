// Deterministic provider plus commands to change and report Pi's active tool loadout.
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function loadoutExtension(pi) {
  // Stands in for an extension tool installed after the session was created.
  if (process.env.LOADOUT_PROBE_TOOL) {
    pi.registerTool({
      name: "probe_tool",
      label: "probe_tool",
      description: "Loadout probe",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "probe ok" }], details: {} }),
    });
  }
  pi.registerCommand("drop-bash", {
    handler: () => pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "bash")),
  });
  pi.registerCommand("loadout", {
    handler: (_args, ctx) => ctx.ui.notify(`loadout:${pi.getActiveTools().join(",")}`, "info"),
  });
  pi.registerProvider("loadout-test", {
    baseUrl: "http://127.0.0.1:1",
    apiKey: "test-only",
    api: "loadout-test",
    models: [
      {
        id: "model",
        name: "Loadout test",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 4096,
      },
    ],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const output = {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
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
      stream.push({ type: "text_start", contentIndex: 0, partial: output });
      stream.push({ type: "text_delta", contentIndex: 0, delta: "ok", partial: output });
      stream.push({ type: "text_end", contentIndex: 0, content: "ok", partial: output });
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
      return stream;
    },
  });
}
