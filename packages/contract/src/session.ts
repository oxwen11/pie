import { eventIterator, type } from "@orpc/contract";
import { Schema } from "effect";
import { mcp } from "orpc-mcp";

import {
  AgentModelStateSchema,
  ArchiveSessionInputSchema,
  CreateSessionInputSchema,
  CreateSessionOutputSchema,
  CreateWorktreeInputSchema,
  PrepareSessionOutputSchema,
  serverErrors,
  ListSessionsInputSchema,
  type ListSessionsOutput,
  PromptInputSchema,
  PromptPartSchema,
  PromptOutputSchema,
  ReplaceQueueInputSchema,
  RefInputSchema,
  RenameSessionInputSchema,
  ResolveRefInputSchema,
  RespondToAgentRequestInputSchema,
  SetAgentModelInputSchema,
  type SessionMessages,
  SessionRefSchema,
  SessionWorkspaceSchema,
  type SessionRuntimeSnapshot,
  SessionStatusSchema,
  SubscribeInputSchema,
  type SubscribeStreamEvent,
  WorktreeMissingErrorDataSchema,
} from "./domain";
import { oc, toStandardSchema } from "./orpc";

const base = oc.errors(serverErrors);

export const HandoffInputSchema = Schema.Struct({
  from: SessionRefSchema,
  prompt: Schema.NonEmptyString,
});
export const HandoffOutputSchema = Schema.Struct({
  parts: Schema.Array(PromptPartSchema).check(Schema.isNonEmpty()),
});

export const RunSessionInputSchema = Schema.Struct({
  projectId: Schema.String.check(Schema.isUUID()),
  prompt: Schema.NonEmptyString,
  from: Schema.optionalKey(SessionRefSchema),
  worktree: Schema.optionalKey(CreateWorktreeInputSchema),
  provider: Schema.optionalKey(Schema.NonEmptyString),
  modelId: Schema.optionalKey(Schema.NonEmptyString),
});
export const RunSessionOutputSchema = Schema.Struct({
  ref: SessionRefSchema,
  turnId: Schema.String,
  workspace: SessionWorkspaceSchema,
});
export const WaitSessionInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  timeoutSeconds: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 25 })),
  ),
});
export const WaitSessionOutputSchema = Schema.Struct({
  state: Schema.Literals(["idle", "running", "request", "crashed"]),
  requestId: Schema.optionalKey(Schema.String),
});

export const sessionContract = {
  create: base.input(CreateSessionInputSchema).output(CreateSessionOutputSchema),
  prepare: base
    .errors({ WORKTREE_MISSING: { data: toStandardSchema(WorktreeMissingErrorDataSchema) } })
    .input(RefInputSchema)
    .output(PrepareSessionOutputSchema),
  restoreWorktree: base.input(RefInputSchema).output(PrepareSessionOutputSchema),
  close: base.input(RefInputSchema),

  ls: base
    .meta(mcp.tool({ name: "session_ls", description: "List sessions in a project" }))
    .input(ListSessionsInputSchema)
    .output(type<ListSessionsOutput>()),
  rename: base
    .meta(mcp.tool({ name: "session_rename", description: "Rename a session" }))
    .input(RenameSessionInputSchema),
  archive: base
    .meta(mcp.tool({ name: "session_archive", description: "Archive or unarchive a session" }))
    .input(ArchiveSessionInputSchema),
  logs: base
    .meta(mcp.tool({ name: "session_logs", description: "Read a session's messages" }))
    .input(RefInputSchema)
    .output(type<SessionMessages>()),
  transcriptPath: base.input(RefInputSchema).output(type<{ readonly path?: string }>()),
  resolveRef: base.input(ResolveRefInputSchema).output(SessionRefSchema),

  /** The prompt parts for a new Session that continues `from`: budgeted history, then `prompt`. Creates nothing. */
  handoff: base
    .meta(
      mcp.tool({
        name: "session_handoff",
        description: "Build prompt parts that continue another session. Creates nothing.",
      }),
    )
    .input(HandoffInputSchema)
    .output(HandoffOutputSchema),
  run: base
    .meta(
      mcp.tool({
        name: "session_run",
        description:
          "Start a session and send a prompt without waiting. Copy budgeted history from `from` before creating anything.",
      }),
    )
    .input(RunSessionInputSchema)
    .output(RunSessionOutputSchema),
  wait: base
    .meta(
      mcp.tool({
        name: "session_wait",
        description:
          "Wait up to 25s for a session to go idle. Returns idle, running, request, or crashed.",
      }),
    )
    .input(WaitSessionInputSchema)
    .output(WaitSessionOutputSchema),
  send: base
    .meta(mcp.tool({ name: "session_send", description: "Send a prompt to a session" }))
    .input(PromptInputSchema)
    .output(PromptOutputSchema),
  queue: base
    .meta(mcp.tool({ name: "session_queue", description: "Replace a session's queued prompts" }))
    .input(ReplaceQueueInputSchema),
  interrupt: base
    .meta(mcp.tool({ name: "session_interrupt", description: "Interrupt the in-flight turn" }))
    .input(RefInputSchema),
  respond: base.input(RespondToAgentRequestInputSchema),
  getStatus: base.input(RefInputSchema).output(SessionStatusSchema),
  getSnapshot: base.input(RefInputSchema).output(type<SessionRuntimeSnapshot>()),

  getModelState: base.input(RefInputSchema).output(AgentModelStateSchema),
  model: base
    .meta(mcp.tool({ name: "session_model", description: "Set a session's model" }))
    .input(SetAgentModelInputSchema)
    .output(AgentModelStateSchema),

  subscribe: base.input(SubscribeInputSchema).output(eventIterator(type<SubscribeStreamEvent>())),
};

/** Root shortcuts for the daily verbs. No MCP meta: `session.*` is the one tool registration. */
export const sessionRootContract = {
  run: base.input(RunSessionInputSchema).output(RunSessionOutputSchema),
  send: base.input(PromptInputSchema).output(PromptOutputSchema),
  ls: base.input(ListSessionsInputSchema).output(type<ListSessionsOutput>()),
  logs: base.input(RefInputSchema).output(type<SessionMessages>()),
  wait: base.input(WaitSessionInputSchema).output(WaitSessionOutputSchema),
  interrupt: base.input(RefInputSchema),
};
