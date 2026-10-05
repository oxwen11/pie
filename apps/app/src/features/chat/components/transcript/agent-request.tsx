import type { AgentRequest, AgentResponse } from "@/features/chat/runtime/agent-requests";

import { PlanRequestView } from "./plan-request";
import { QuestionRequestView } from "./question-request";
import { ToolRequestView } from "./tool-request";

// Routes a request to the view for its `type` (the Tier-1 discriminant).
// Each request type owns a dedicated component; this file is routing only.
export function AgentRequestView({
  request,
  onRespond,
}: {
  request: AgentRequest;
  onRespond: (requestId: string, response: AgentResponse) => void;
}) {
  switch (request.type) {
    case "question":
      return (
        <div className="py-1.5">
          <QuestionRequestView request={request} onRespond={onRespond} />
        </div>
      );
    case "plan":
      return (
        <div className="py-1.5">
          <PlanRequestView request={request} onRespond={onRespond} />
        </div>
      );
    case "tool":
      return (
        <div className="py-1.5">
          <ToolRequestView request={request} onRespond={onRespond} />
        </div>
      );
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}
