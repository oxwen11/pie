import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  TerminalCloseInputSchema,
  TerminalConnectInputSchema,
  TerminalResizeInputSchema,
  TerminalWriteInputSchema,
} from "../src/terminal";

const UUID = "0195b4b3-6dc4-7d41-a9ce-3ab5dcb6cc61";
const ref = { projectId: UUID, sessionId: "s1" };

const accepts = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

describe("terminal wire schemas", () => {
  it("accepts a session-scoped connect payload and optional size", () => {
    expect(accepts(TerminalConnectInputSchema, { ref, terminalId: "term-1" })).toBe(true);
    expect(
      accepts(TerminalConnectInputSchema, { ref, terminalId: "term-1", cols: 80, rows: 24 }),
    ).toBe(true);
  });

  it("rejects an empty terminalId or a non-UUID projectId", () => {
    expect(accepts(TerminalConnectInputSchema, { ref, terminalId: "" })).toBe(false);
    expect(
      accepts(TerminalConnectInputSchema, {
        ref: { ...ref, projectId: "not-a-uuid" },
        terminalId: "term-1",
      }),
    ).toBe(false);
  });

  it("rejects write payloads that are empty or past the 64 KiB bound", () => {
    expect(accepts(TerminalWriteInputSchema, { ref, terminalId: "term-1", data: "ls\n" })).toBe(
      true,
    );
    expect(accepts(TerminalWriteInputSchema, { ref, terminalId: "term-1", data: "" })).toBe(false);
    expect(
      accepts(TerminalWriteInputSchema, {
        ref,
        terminalId: "term-1",
        data: "x".repeat(65_537),
      }),
    ).toBe(false);
  });

  it("rejects a resize that is not a positive grid", () => {
    expect(
      accepts(TerminalResizeInputSchema, { ref, terminalId: "term-1", cols: 80, rows: 24 }),
    ).toBe(true);
    expect(
      accepts(TerminalResizeInputSchema, { ref, terminalId: "term-1", cols: 0, rows: 24 }),
    ).toBe(false);
  });

  it("accepts a close payload for the same session-scoped id", () => {
    expect(accepts(TerminalCloseInputSchema, { ref, terminalId: "term-1" })).toBe(true);
  });
});
