import { eventIterator, oc, type } from "@orpc/contract";

import {
  AgentModelStateSchema,
  ArchiveSessionInputSchema,
  CreateSessionInputSchema,
  CreateSessionOutputSchema,
  PrepareSessionOutputSchema,
  serverErrors,
  ListSessionsInputSchema,
  type ListSessionsOutput,
  PromptInputSchema,
  PromptOutputSchema,
  RefInputSchema,
  RenameSessionInputSchema,
  ResolveRefInputSchema,
  RespondToAgentRequestInputSchema,
  SetAgentModelInputSchema,
  type SessionMessages,
  SessionRefSchema,
  type SessionRuntimeSnapshot,
  SessionStatusSchema,
  SubscribeInputSchema,
  type SubscribeStreamEvent,
  toStandardSchema,
} from "./domain";

const base = oc.errors(serverErrors);

export const sessionContract = {
  create: base
    .input(toStandardSchema(CreateSessionInputSchema))
    .output(toStandardSchema(CreateSessionOutputSchema)),
  prepare: base
    .input(toStandardSchema(RefInputSchema))
    .output(toStandardSchema(PrepareSessionOutputSchema)),
  close: base.input(toStandardSchema(RefInputSchema)),

  list: base.input(toStandardSchema(ListSessionsInputSchema)).output(type<ListSessionsOutput>()),
  rename: base.input(toStandardSchema(RenameSessionInputSchema)),
  archive: base.input(toStandardSchema(ArchiveSessionInputSchema)),
  delete: base.input(toStandardSchema(RefInputSchema)),
  getMessages: base.input(toStandardSchema(RefInputSchema)).output(type<SessionMessages>()),
  resolveRef: base
    .input(toStandardSchema(ResolveRefInputSchema))
    .output(toStandardSchema(SessionRefSchema)),

  prompt: base
    .input(toStandardSchema(PromptInputSchema))
    .output(toStandardSchema(PromptOutputSchema)),
  interrupt: base.input(toStandardSchema(RefInputSchema)),
  respondToAgentRequest: base.input(toStandardSchema(RespondToAgentRequestInputSchema)),
  getStatus: base
    .input(toStandardSchema(RefInputSchema))
    .output(toStandardSchema(SessionStatusSchema)),
  getSnapshot: base.input(toStandardSchema(RefInputSchema)).output(type<SessionRuntimeSnapshot>()),

  getModelState: base
    .input(toStandardSchema(RefInputSchema))
    .output(toStandardSchema(AgentModelStateSchema)),
  setModel: base
    .input(toStandardSchema(SetAgentModelInputSchema))
    .output(toStandardSchema(AgentModelStateSchema)),

  subscribe: base
    .input(toStandardSchema(SubscribeInputSchema))
    .output(eventIterator(type<SubscribeStreamEvent>())),
};
