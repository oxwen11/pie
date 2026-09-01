import type { SessionRef } from "@getpie/contract";
import { cn } from "@getpie/ui/lib/utils";

import { ChatInputComposer } from "@/features/chat/components/chat-input-composer";
import { ChatModelSelect } from "@/features/chat/components/chat-model-select";
import { ChatSessionProvider } from "@/features/chat/components/chat-session-provider";
import { ChatTranscript } from "@/features/chat/components/chat-transcript";
import { SlashCommandMenu } from "@/features/chat/components/input/slash-command-menu";
import { useSlashCommandState } from "@/features/chat/hooks/use-slash-command-state";

export function Chat({
  className,
  sessionRef,
  cwd: _cwd,
}: {
  className?: string;
  sessionRef: SessionRef;
  cwd: string | undefined;
}) {
  const commandState = useSlashCommandState(sessionRef.projectId);

  return (
    <ChatSessionProvider sessionRef={sessionRef}>
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        <ChatTranscript />
        <div className="mx-auto w-full max-w-4xl min-w-80 flex-shrink-0 p-2">
          <ChatInputComposer toolbar={<ChatModelSelect sessionRef={sessionRef} />}>
            <SlashCommandMenu state={commandState} />
          </ChatInputComposer>
        </div>
      </div>
    </ChatSessionProvider>
  );
}
