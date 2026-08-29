import { eventIterator, type } from "@orpc/contract";

import {
  AgentModelStateSchema,
  AgentThinkingStateSchema,
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
  SetAgentThinkingLevelInputSchema,
  type SessionMessages,
  SessionRefSchema,
  type SessionRuntimeSnapshot,
  SessionStatusSchema,
  SubscribeInputSchema,
  type SubscribeStreamEvent,
} from "./domain";
import { oc } from "./orpc";

const base = oc.errors(serverErrors);

export const sessionContract = {
  create: base.input(CreateSessionInputSchema).output(CreateSessionOutputSchema),
  prepare: base.input(RefInputSchema).output(PrepareSessionOutputSchema),
  close: base.input(RefInputSchema),

  list: base.input(ListSessionsInputSchema).output(type<ListSessionsOutput>()),
  rename: base.input(RenameSessionInputSchema),
  archive: base.input(ArchiveSessionInputSchema),
  delete: base.input(RefInputSchema),
  getMessages: base.input(RefInputSchema).output(type<SessionMessages>()),
  resolveRef: base.input(ResolveRefInputSchema).output(SessionRefSchema),

  prompt: base.input(PromptInputSchema).output(PromptOutputSchema),
  interrupt: base.input(RefInputSchema),
  respondToAgentRequest: base.input(RespondToAgentRequestInputSchema),
  getStatus: base.input(RefInputSchema).output(SessionStatusSchema),
  getSnapshot: base.input(RefInputSchema).output(type<SessionRuntimeSnapshot>()),

  getModelState: base.input(RefInputSchema).output(AgentModelStateSchema),
  setModel: base.input(SetAgentModelInputSchema).output(AgentModelStateSchema),
  getThinkingState: base.input(RefInputSchema).output(AgentThinkingStateSchema),
  setThinkingLevel: base.input(SetAgentThinkingLevelInputSchema).output(AgentThinkingStateSchema),

  subscribe: base.input(SubscribeInputSchema).output(eventIterator(type<SubscribeStreamEvent>())),
};
