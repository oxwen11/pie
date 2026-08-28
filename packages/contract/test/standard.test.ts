import { toStandardSchema } from "@getpie/contract";
import { eventIterator } from "@orpc/contract";
import { tool } from "ai";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { oc } from "../src/orpc";

const GreetingInput = Schema.Struct({
  name: Schema.String,
});

describe("Effect Schema oRPC integration", () => {
  it("accepts Effect Schema on .input/.output without a local wrapper", async () => {
    const procedure = oc.input(GreetingInput).output(Schema.Struct({ greeting: Schema.String }));
    const [inputSchema] = procedure["~orpc"].inputSchemas;

    expect(inputSchema).toBeDefined();
    const validation = await inputSchema!["~standard"].validate({ name: "Ada" });
    expect("issues" in validation).toBe(false);
  });

  it("exposes official toStandardSchema to AI SDK", async () => {
    const converted = toStandardSchema(GreetingInput);
    const validation = await converted["~standard"].validate({ name: "Ada" });

    expect("issues" in validation).toBe(false);

    const aiTool = tool({
      description: "Greet a person",
      inputSchema: converted,
      execute: async ({ name }) => `Hello, ${name}`,
    });

    expect(aiTool.inputSchema).toBe(converted);
  });

  it("coexists with Zod and supports event iterator yield schemas", () => {
    const router = {
      effect: oc.input(GreetingInput),
      zod: oc.input(z.object({ id: z.string() })),
      events: oc.output(eventIterator(toStandardSchema(GreetingInput))),
    };

    expect(router.effect["~orpc"].inputSchemas).toHaveLength(1);
    expect(router.zod["~orpc"].inputSchemas).toHaveLength(1);
    expect(router.events["~orpc"].outputSchemas).toHaveLength(1);
  });

  it("returns Standard Schema issues for invalid input", async () => {
    const procedure = oc.input(GreetingInput);
    const [inputSchema] = procedure["~orpc"].inputSchemas;
    const validation = await inputSchema!["~standard"].validate({ name: 42 });

    expect("issues" in validation).toBe(true);
  });
});
