import {
  AgentRequestSchema,
  CompactionReasonSchema,
  type CompactionResult,
  type PieUIMessageChunk,
  PromptPartSchema,
  TokenUsageSchema,
  TurnErrorSchema,
} from "@getpie/contract";
import { Schema } from "effect";

/**
 * Harness-internal event vocabulary. The public `@getpie/contract` wire model is
 * a flat tagged union (`SessionScopedEvent` keyed by `SessionRef`); this module
 * keeps the harness's own ergonomic `defineEvent`/`SessionEnvelope` shape, keyed
 * by the agent-native `sessionId`. `HarnessAgentSession` translates these
 * drafts into the wire model at the fan-out boundary (attaching the `SessionRef`
 * and stamping the per-session `seq`).
 */

export interface EventDef<
  T extends string = string,
  S extends Schema.Struct<Schema.Struct.Fields> = Schema.Struct<Schema.Struct.Fields>,
> {
  readonly type: T;
  readonly schema: S;
}

export type EventValue<D extends EventDef> =
  D extends EventDef<infer T, infer S> ? { readonly type: T } & S["Type"] : never;

export function defineEvent<const T extends string, const F extends Schema.Struct.Fields>(def: {
  readonly type: T;
  readonly schema: F;
}): EventDef<T, Schema.Struct<F>> {
  return { type: def.type, schema: Schema.Struct(def.schema) };
}

const sid = { sessionId: Schema.String };

export const SessionPromptSubmitted = defineEvent({
  type: "session.prompt.submitted",
  schema: {
    ...sid,
    messageId: Schema.String,
    parts: Schema.Array(PromptPartSchema),
  },
});
export const SessionTurnStarted = defineEvent({
  type: "session.turn.started",
  schema: { ...sid, turnId: Schema.String },
});
export const SessionTurnEnded = defineEvent({
  type: "session.turn.ended",
  schema: {
    ...sid,
    turnId: Schema.String,
    outcome: Schema.Literals(["completed", "failed", "canceled"]),
    usage: Schema.optionalKey(TokenUsageSchema),
    error: Schema.optionalKey(TurnErrorSchema),
  },
});
export const SessionRequestAsked = defineEvent({
  type: "session.request.asked",
  schema: { ...sid, request: AgentRequestSchema },
});
export const SessionRequestReplied = defineEvent({
  type: "session.request.replied",
  schema: { ...sid, requestId: Schema.String },
});
export const SessionQueueUpdated = defineEvent({
  type: "session.queue.updated",
  schema: {
    ...sid,
    steering: Schema.Array(Schema.String),
    followUp: Schema.Array(Schema.String),
  },
});
export const SessionCompactionStarted = defineEvent({
  type: "session.compaction.started",
  schema: { ...sid, reason: CompactionReasonSchema },
});
export const SessionCompactionEnded = defineEvent({
  type: "session.compaction.ended",
  schema: {
    ...sid,
    // Produced by the Pi adapter, like UIMessage chunks; not caller input.
    result: Schema.declare<CompactionResult>(
      (value): value is CompactionResult =>
        typeof value === "object" && value !== null && "outcome" in value,
    ),
  },
});
export const SessionCrashed = defineEvent({
  type: "session.crashed",
  schema: { ...sid, reason: Schema.String },
});
export const SessionCreated = defineEvent({
  type: "session.created",
  schema: { sessionId: Schema.String },
});
export const SessionUpdated = defineEvent({
  type: "session.updated",
  schema: { sessionId: Schema.String },
});
export const SessionDeleted = defineEvent({
  type: "session.deleted",
  schema: { sessionId: Schema.String },
});
export const SessionRenamed = defineEvent({
  type: "session.renamed",
  schema: { sessionId: Schema.String, title: Schema.String },
});
export const ProjectUpdated = defineEvent({
  type: "project.updated",
  schema: { projectId: Schema.String },
});

export const SessionEventDefs = [
  SessionPromptSubmitted,
  SessionTurnStarted,
  SessionTurnEnded,
  SessionRequestAsked,
  SessionRequestReplied,
  SessionQueueUpdated,
  SessionCompactionStarted,
  SessionCompactionEnded,
  SessionCrashed,
] as const;
export type SessionEvent = EventValue<(typeof SessionEventDefs)[number]>;

export const GlobalEventDefs = [
  SessionCreated,
  SessionUpdated,
  SessionDeleted,
  SessionRenamed,
  ProjectUpdated,
] as const;
export type GlobalEvent = EventValue<(typeof GlobalEventDefs)[number]>;

export type SessionEnvelopeBody = PieUIMessageChunk | SessionEvent;
export type SessionEnvelope = {
  readonly sessionId: string;
  readonly seq: number;
  readonly body: SessionEnvelopeBody;
};
export type SessionEnvelopeDraft = Omit<SessionEnvelope, "seq">;

export const isSessionEvent = (body: SessionEnvelopeBody): body is SessionEvent =>
  body.type.includes(".");
