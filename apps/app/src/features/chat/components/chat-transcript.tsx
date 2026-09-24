import { Message } from "@getpie/ui/ai-elements/message";
import { PieLoader } from "@getpie/ui/ai-elements/pie-loader";
import { Shimmer } from "@getpie/ui/ai-elements/shimmer";
import { useStore } from "zustand";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/conversation";
import type { AgentResponse } from "@/features/chat/runtime/agent-requests";
import type { ChatStoreState, HistoryStatus } from "@/features/chat/runtime/chat-state";

import { useChatSession } from "./chat-session-context";
import { AgentRequestView } from "./transcript/agent-request";
import { MessageView } from "./transcript/message-view";
import { ModelErrorCard } from "./transcript/model-error-card";

function TranscriptStatusMessage({ label }: { label: string }) {
  return (
    <Message
      from="assistant"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-state="loading"
    >
      <PieLoader aria-hidden />
      <Shimmer>{label}</Shimmer>
    </Message>
  );
}

// What an empty transcript means, in one place: nothing until the settled
// history floor has landed, so an unread session shows the read rather than a
// verdict about the conversation. "settled" renders nothing — a session with no
// messages simply has none yet.
function EmptyTranscript({ historyStatus }: { historyStatus: HistoryStatus }) {
  if (historyStatus === "loading") {
    return <TranscriptStatusMessage label="Loading earlier messages…" />;
  }
  if (historyStatus === "unavailable") {
    return (
      <div className="text-muted-foreground mx-auto max-w-md py-12 text-center text-sm">
        Earlier messages couldn&apos;t be loaded. The agent still has its own context, so you can
        pick up where you left off.
      </div>
    );
  }
  return null;
}

// Pure view over a store snapshot: message stream, then retry/error lines, then
// pending agent request cards. Only the last message can be streaming, so only
// it gets streaming affordances.
function ChatTranscriptView({
  sessionId,
  snapshot,
  onRespond,
}: {
  sessionId: string;
  snapshot: ChatStoreState;
  onRespond: (requestId: string, response: AgentResponse) => void;
}) {
  // StickToBottom's first growth uses `initial`, later growth uses `resize`.
  // Keep the scroller off-tree until the history floor lands so the dump is
  // that first growth — same path as opening a session that already has data.
  if (snapshot.historyStatus === "loading") {
    return (
      <div className="relative flex-1 overflow-y-auto py-4">
        <EmptyTranscript historyStatus="loading" />
      </div>
    );
  }

  const lastIndex = snapshot.messages.length - 1;
  const turnInProgress = snapshot.status === "submitted" || snapshot.status === "streaming";
  return (
    <Conversation key={sessionId}>
      <ConversationContent scrollClassName="scrollbar-thin" className="px-0 py-4">
        {snapshot.messages.length === 0 && (
          <EmptyTranscript historyStatus={snapshot.historyStatus} />
        )}
        {snapshot.messages.map((message, index) => (
          <MessageView
            key={message.id}
            message={message}
            isStreaming={turnInProgress && index === lastIndex}
          />
        ))}
        {snapshot.status === "submitted" && <TranscriptStatusMessage label="Thinking…" />}
        {snapshot.retryNotice && (
          <div className="text-muted-foreground py-1.5 text-xs">{snapshot.retryNotice}</div>
        )}
        {snapshot.error && <ModelErrorCard error={snapshot.error} />}
        {snapshot.pendingRequests.map((request) => (
          <AgentRequestView key={request.id} request={request} onRespond={onRespond} />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

// Context-aware wrapper: subscribes to the whole store here so per-token
// message updates re-render only the transcript, never its siblings (the
// composer subscribes narrowly on its own).
export function ChatTranscript() {
  const { sessionId, store, respondToRequest } = useChatSession();
  const snapshot = useStore(store);
  return (
    <ChatTranscriptView sessionId={sessionId} snapshot={snapshot} onRespond={respondToRequest} />
  );
}
