import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AgentCommandSchema,
  ArchiveSessionInputSchema,
  CollectionEventTypes,
  ListAgentCommandsInputSchema,
  ListSessionsInputSchema,
  MAX_SESSION_TITLE_CHARS,
  RenameSessionInputSchema,
  SessionCapabilitiesSchema,
  type ServerEvent,
  serverErrors,
  ServerErrorCodes,
  isSessionScopedEvent,
  PromptInputSchema,
  SessionRefSchema,
  SessionScopedEventTypes,
  SubscribeInputSchema,
} from "../src/domain";

const UUID = "0195b4b3-6dc4-7d41-a9ce-3ab5dcb6cc61";
const ref = { projectId: UUID, sessionId: "s1" };

const accepts = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

describe("SessionRef", () => {
  it("accepts a UUID projectId with a non-empty sessionId", () => {
    expect(accepts(SessionRefSchema, ref)).toBe(true);
  });

  it("rejects a non-UUID projectId", () => {
    expect(accepts(SessionRefSchema, { ...ref, projectId: "not-a-uuid" })).toBe(false);
  });

  it("rejects an empty sessionId", () => {
    expect(accepts(SessionRefSchema, { ...ref, sessionId: "" })).toBe(false);
  });
});

describe("ArchiveSessionInput", () => {
  it("requires an explicit archived state", () => {
    expect(accepts(ArchiveSessionInputSchema, { ref, archived: true })).toBe(true);
    expect(accepts(ArchiveSessionInputSchema, { ref })).toBe(false);
  });
});

describe("RenameSessionInput", () => {
  it("accepts a trimmed, non-empty title within the bound", () => {
    expect(accepts(RenameSessionInputSchema, { ref, title: "Login bug" })).toBe(true);
    expect(
      accepts(RenameSessionInputSchema, { ref, title: "x".repeat(MAX_SESSION_TITLE_CHARS) }),
    ).toBe(true);
  });

  it("rejects a title that would render as a blank row", () => {
    expect(accepts(RenameSessionInputSchema, { ref, title: "" })).toBe(false);
    expect(accepts(RenameSessionInputSchema, { ref, title: "   " })).toBe(false);
    // Untrimmed rather than blank, but the server stores the string as given.
    expect(accepts(RenameSessionInputSchema, { ref, title: " Login bug " })).toBe(false);
  });

  it("rejects a title past the bound", () => {
    expect(
      accepts(RenameSessionInputSchema, { ref, title: "x".repeat(MAX_SESSION_TITLE_CHARS + 1) }),
    ).toBe(false);
  });

  it("rejects the legacy name field", () => {
    expect(accepts(RenameSessionInputSchema, { ref, name: "Login bug" })).toBe(false);
  });
});

describe("ListSessionsInput", () => {
  it("accepts an archived filter and lets callers omit it for the active default", () => {
    expect(accepts(ListSessionsInputSchema, { projectId: UUID, archived: false })).toBe(true);
    expect(accepts(ListSessionsInputSchema, { projectId: UUID, archived: true })).toBe(true);
    expect(accepts(ListSessionsInputSchema, { projectId: UUID })).toBe(true);
  });
});

describe("Agent commands", () => {
  it("accepts prompt templates and skill invocations without host source paths", () => {
    expect(
      accepts(AgentCommandSchema, {
        name: "explain",
        description: "Explain the current code",
        source: "prompt",
      }),
    ).toBe(true);
    expect(accepts(AgentCommandSchema, { name: "skill:review", source: "skill" })).toBe(true);
    expect(accepts(ListAgentCommandsInputSchema, { projectId: UUID })).toBe(true);
  });

  it("keeps session capability commands independent from submittable input commands", () => {
    expect(
      accepts(SessionCapabilitiesSchema, {
        commands: [{ name: "reload", description: "Reload extensions" }],
        supportsResume: true,
        supportsSteering: true,
        supportsPermissions: false,
      }),
    ).toBe(true);
    expect(accepts(AgentCommandSchema, { name: "reload", source: "extension" })).toBe(false);
    expect(accepts(ListAgentCommandsInputSchema, {})).toBe(true);
  });
});

describe("PromptInput", () => {
  it("accepts a text part", () => {
    expect(accepts(PromptInputSchema, { ref, parts: [{ type: "text", text: "hi" }] })).toBe(true);
  });

  it("rejects empty parts", () => {
    expect(accepts(PromptInputSchema, { ref, parts: [] })).toBe(false);
  });

  it("rejects an empty text part", () => {
    expect(accepts(PromptInputSchema, { ref, parts: [{ type: "text", text: "" }] })).toBe(false);
  });

  it("keeps the file part shape on the wire (validated, server rejects with UNSUPPORTED)", () => {
    expect(
      accepts(PromptInputSchema, {
        ref,
        parts: [{ type: "file", mediaType: "image/png", url: "https://x/y.png" }],
      }),
    ).toBe(true);
  });
});

describe("SubscribeInput scope", () => {
  it("accepts a session scope", () => {
    expect(accepts(SubscribeInputSchema, { scope: { kind: "session", ref } })).toBe(true);
  });

  it("accepts the global scope", () => {
    expect(accepts(SubscribeInputSchema, { scope: { kind: "global" } })).toBe(true);
  });

  it("rejects an unknown scope kind", () => {
    expect(accepts(SubscribeInputSchema, { scope: { kind: "project", projectId: UUID } })).toBe(
      false,
    );
  });
});

describe("event partition", () => {
  it("session-scoped and collection type sets are disjoint", () => {
    const collection = new Set<string>(CollectionEventTypes);
    for (const t of SessionScopedEventTypes) expect(collection.has(t)).toBe(false);
  });

  it("isSessionScopedEvent splits the union", () => {
    const chunk: ServerEvent = {
      ref,
      seq: 1,
      type: "session.turn.started",
      turnId: "t1",
    };
    const created: ServerEvent = { ref, type: "session.created" };
    expect(isSessionScopedEvent(chunk)).toBe(true);
    expect(isSessionScopedEvent(created)).toBe(false);
  });
});

describe("server error map", () => {
  it("exposes every stable code as an oRPC error entry", () => {
    for (const code of ServerErrorCodes) expect(serverErrors).toHaveProperty(code);
  });
});
