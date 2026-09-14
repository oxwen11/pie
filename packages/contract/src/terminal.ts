import { eventIterator, type } from "@orpc/contract";
import { Schema } from "effect";

import { SessionRefSchema, serverErrors } from "./domain";
import { oc } from "./orpc";

const TerminalIdSchema = Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(128));
const TerminalColsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
  Schema.isLessThanOrEqualTo(1000),
);
const TerminalRowsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
  Schema.isLessThanOrEqualTo(500),
);

export const TerminalSessionInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  terminalId: TerminalIdSchema,
});
export type TerminalSessionInput = typeof TerminalSessionInputSchema.Type;

export const TerminalConnectInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  terminalId: TerminalIdSchema,
  cols: Schema.optionalKey(TerminalColsSchema),
  rows: Schema.optionalKey(TerminalRowsSchema),
});
export type TerminalConnectInput = typeof TerminalConnectInputSchema.Type;

export const TerminalWriteInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  terminalId: TerminalIdSchema,
  data: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65_536)),
});
export type TerminalWriteInput = typeof TerminalWriteInputSchema.Type;

export const TerminalResizeInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  terminalId: TerminalIdSchema,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
});
export type TerminalResizeInput = typeof TerminalResizeInputSchema.Type;

export const TerminalCloseInputSchema = TerminalSessionInputSchema;
export type TerminalCloseInput = typeof TerminalCloseInputSchema.Type;

export type TerminalConnectEvent =
  | { readonly type: "snapshot"; readonly history: string }
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "exited"; readonly exitCode: number | null };

const base = oc.errors(serverErrors);

/**
 * Session-scoped host PTYs. Cwd is always the session workspace — callers never
 * supply a path. `connect` yields a snapshot then only new output.
 */
export const terminalContract = {
  connect: base
    .input(TerminalConnectInputSchema)
    .output(eventIterator(type<TerminalConnectEvent>())),
  write: base.input(TerminalWriteInputSchema),
  resize: base.input(TerminalResizeInputSchema),
  close: base.input(TerminalCloseInputSchema),
};
