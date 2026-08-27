import { InspectorTargetSchema, PromptDeliverySchema } from "@getpie/contract";
import { Schema } from "effect";

/**
 * Pi session I/O types. The server owns `SessionRef` translation and hands Pi
 * these narrow, native-keyed shapes.
 */

export const CreateSessionInputSchema = Schema.Struct({
  cwd: Schema.String,
  sessionId: Schema.optionalKey(Schema.String),
  provider: Schema.optionalKey(Schema.String),
  modelId: Schema.optionalKey(Schema.String),
});
export type CreateSessionInput = typeof CreateSessionInputSchema.Type;

export const ResumeSessionInputSchema = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
});
export type ResumeSessionInput = typeof ResumeSessionInputSchema.Type;

export const ResumeManagedSessionInputSchema = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
});
export type ResumeManagedSessionInput = typeof ResumeManagedSessionInputSchema.Type;

export const CreateManagedSessionResultSchema = Schema.Struct({
  sessionId: Schema.String,
});
export type CreateManagedSessionResult = typeof CreateManagedSessionResultSchema.Type;

export const UserInputPartSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("data-inspector"),
    data: Schema.Array(InspectorTargetSchema),
  }),
]);
export type UserInputPart = typeof UserInputPartSchema.Type;

export const UserInputSchema = Schema.Struct({
  parts: Schema.Array(UserInputPartSchema),
  delivery: Schema.optionalKey(PromptDeliverySchema),
});
export type UserInput = typeof UserInputSchema.Type;

export const PromptReceiptSchema = Schema.Struct({ turnId: Schema.String });
export type PromptReceipt = typeof PromptReceiptSchema.Type;

/** Runtime-only: whether this call opened a new turn (`prompt`) or queued. */
export type RuntimePromptReceipt = PromptReceipt & {
  readonly started: boolean;
};
