import { describe, expect, it } from "vitest";

import { createChatComposerExtensions } from "./chat-composer-extensions";

describe("createChatComposerExtensions", () => {
  it("puts the submit keymap after the base schema", () => {
    const extensions = createChatComposerExtensions(
      { submit: () => undefined } as never,
      "Ask Pi anything...",
    );
    expect(extensions.at(-1)?.name).toBe("chatSubmitKeymap");
    expect(extensions.some((extension) => extension.name === "placeholder")).toBe(true);
  });
});
