import { cn } from "@getpie/ui/lib/utils";

import { ChatInputComposer } from "@/features/chat/components/chat-input-composer";
import { ChatModelSelect } from "@/features/chat/components/chat-model-select";
import { ChatSessionProvider } from "@/features/chat/components/chat-session-provider";
import { ChatTranscript } from "@/features/chat/components/chat-transcript";
import { type EnvironmentSessionRef, sessionRefKey } from "@/lib/session-ref";

export function Chat({
  className,
  sessionRef,
}: {
  className?: string;
  sessionRef: EnvironmentSessionRef;
}) {
  return (
    <ChatSessionProvider sessionRef={sessionRef}>
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        <ChatTranscript />
        <div className="mx-auto w-full max-w-4xl min-w-80 shrink-0 px-4 pt-2 pb-4">
          <ChatInputComposer
            key={sessionRefKey(sessionRef)}
            sessionRef={sessionRef.ref}
            toolbar={<ChatModelSelect sessionRef={sessionRef.ref} />}
          />
        </div>
      </div>
    </ChatSessionProvider>
  );
}
