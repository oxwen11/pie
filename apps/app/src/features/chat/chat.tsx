import { cn } from "@getpie/ui/lib/utils";

import { ChatInputComposer } from "@/features/chat/components/chat-input-composer";
import { ChatModelSelect } from "@/features/chat/components/chat-model-select";
import { ChatSessionProvider } from "@/features/chat/components/chat-session-provider";
import { ChatTranscript } from "@/features/chat/components/chat-transcript";
import { SlashCommandMenu } from "@/features/chat/components/input/slash-command-menu";
import { useSlashCommandState } from "@/features/chat/hooks/use-slash-command-state";
import { type EnvironmentSessionRef, sessionRefKey } from "@/lib/session-ref";

export function Chat({
  className,
  sessionRef,
}: {
  className?: string;
  sessionRef: EnvironmentSessionRef;
}) {
  const commandState = useSlashCommandState(sessionRef.ref.projectId);
  return (
    <ChatSessionProvider sessionRef={sessionRef}>
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        <ChatTranscript />
        <div className="mx-auto w-full max-w-4xl min-w-80 shrink-0 px-4 pt-2 pb-4">
          <ChatInputComposer
            key={sessionRefKey(sessionRef)}
            sessionRef={sessionRef}
            toolbar={<ChatModelSelect sessionRef={sessionRef.ref} />}
          >
            <SlashCommandMenu state={commandState} />
          </ChatInputComposer>
        </div>
      </div>
    </ChatSessionProvider>
  );
}
