import { ChatModelSelect } from "@/features/chat/components/chat-model-select";
import { ChatSessionProvider } from "@/features/chat/components/chat-session-provider";
import { ChatTranscript } from "@/features/chat/components/chat-transcript";
import { SessionComposer } from "@/features/chat/components/session-composer";
import { type EnvironmentSessionRef, sessionRefKey } from "@/lib/session-ref";

export function Chat({ sessionRef }: { sessionRef: EnvironmentSessionRef }) {
  return (
    <ChatSessionProvider sessionRef={sessionRef}>
      <div className="mx-auto flex min-h-0 w-full max-w-4xl min-w-80 flex-1 flex-col px-4">
        <ChatTranscript />
        <SessionComposer
          key={sessionRefKey(sessionRef)}
          sessionRef={sessionRef}
          toolbar={<ChatModelSelect sessionRef={sessionRef.ref} />}
        />
      </div>
    </ChatSessionProvider>
  );
}
