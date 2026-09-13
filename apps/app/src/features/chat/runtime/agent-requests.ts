import type { AgentRequestAction, AgentResponse } from "@getpie/contract";

export type {
  AgentGrant,
  AgentRequest,
  AgentRequestAction,
  AgentRequestQuestion,
  AgentResponse,
  AgentResponseAnswer,
  PlanApprovalMode,
} from "@getpie/contract";

export function buildToolResponse(action: AgentRequestAction): AgentResponse {
  return {
    type: "tool",
    selectedActionId: action.id,
    behavior: action.behavior,
    grant: action.grant,
    interrupt: action.behavior === "deny" ? action.variant === "danger" : undefined,
  };
}
