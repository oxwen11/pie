import type { AgentRequest } from "@/features/chat/runtime/agent-requests";

import { useChatSession } from "../chat-session-context";
import { PlanRequestView } from "./plan-request";
import { QuestionRequestView } from "./question-request";
import { ToolRequestView } from "./tool-request";

// Routes a request to the view for its `type` (the Tier-1 discriminant).
// Each request type owns a dedicated component; this file is routing only.
export function AgentRequestView({ request }: { request: AgentRequest }) {
  const { respondToRequest } = useChatSession();

  switch (request.type) {
    case "question":
      return <QuestionRequestView request={request} onRespond={respondToRequest} />;
    case "plan":
      return <PlanRequestView request={request} onRespond={respondToRequest} />;
    case "tool":
      return <ToolRequestView request={request} onRespond={respondToRequest} />;
  }
}
