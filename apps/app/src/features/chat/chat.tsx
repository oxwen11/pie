import { ChatModelSelect } from "@/features/chat/components/chat-model-select";
import { ChatSessionProvider } from "@/features/chat/components/chat-session-provider";
import { ChatTranscript } from "@/features/chat/components/chat-transcript";
import { SlashCommandMenu } from "@/features/chat/components/input/slash-command-menu";
import { SessionComposer } from "@/features/chat/components/session-composer";
import { useSlashCommandState } from "@/features/chat/hooks/use-slash-command-state";
import { type EnvironmentSessionRef, sessionRefKey } from "@/lib/session-ref";

export function Chat({ sessionRef }: { sessionRef: EnvironmentSessionRef }) {
  const commandState = useSlashCommandState(sessionRef.ref.projectId);
  return (
    <ChatSessionProvider sessionRef={sessionRef}>
      <div className="grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)_minmax(0,56rem)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
        <ChatTranscript className="col-span-full min-h-0 min-w-0" />
        <SessionComposer
          className="col-start-2 mx-4 min-w-0"
          key={sessionRefKey(sessionRef)}
          sessionRef={sessionRef}
          toolbar={<ChatModelSelect sessionRef={sessionRef.ref} />}
        >
          <SlashCommandMenu state={commandState} />
        </SessionComposer>
      </div>
    </ChatSessionProvider>
  );
}
