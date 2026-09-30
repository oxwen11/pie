import { ChatModelSelect } from "@/features/chat/components/chat-model-select";
import { ChatSessionProvider } from "@/features/chat/components/chat-session-provider";
import { ChatTranscript } from "@/features/chat/components/chat-transcript";
import { SessionComposer } from "@/features/chat/components/session-composer";
import { type EnvironmentSessionRef, sessionRefKey } from "@/lib/session-ref";

export function Chat({ sessionRef }: { sessionRef: EnvironmentSessionRef }) {
  return (
    <ChatSessionProvider sessionRef={sessionRef}>
      <div className="grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)_minmax(0,56rem)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
        <ChatTranscript className="col-span-full min-h-0 min-w-0" />
        <SessionComposer
          className="col-start-2 mx-4 min-w-0"
          key={sessionRefKey(sessionRef)}
          sessionRef={sessionRef}
          toolbar={<ChatModelSelect sessionRef={sessionRef.ref} />}
        />
      </div>
    </ChatSessionProvider>
  );
}
