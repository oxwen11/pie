import { Shimmer } from "@getpie/ui/ai-elements/shimmer";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import {
  claimSessionStartPrompt,
  clearPendingSessionStart,
  type PendingSessionStart,
} from "@/features/chat/pending-session-start";
import { useChatManager } from "@/features/chat/runtime/chat-context";
import { useChatHandle } from "@/features/chat/runtime/use-chat-handle";

function SessionStartProgress({ mode }: { mode: PendingSessionStart["workspaceMode"] }) {
  if (mode === "worktree") {
    return <Shimmer className="text-sm">Creating worktree…</Shimmer>;
  }
  return <Shimmer className="text-sm">Starting conversation…</Shimmer>;
}

export function SessionStartBootstrap({
  pending,
  children,
}: {
  pending: PendingSessionStart;
  children: ReactNode;
}) {
  const manager = useChatManager();
  const chat = useChatHandle(pending.ref);
  const router = useRouter();
  const status = useStore(chat.store, (state) => state.status);
  const [workspaceMode] = useState(pending.workspaceMode);

  useEffect(() => {
    if (!claimSessionStartPrompt(pending.ref.sessionId)) return;
    void manager.chatFor(pending.ref).prompt(pending.text);
    clearPendingSessionStart(pending.ref.sessionId);
  }, [manager, pending]);

  const turnStarted = status === "streaming";

  useEffect(() => {
    if (!turnStarted) return;
    void router.invalidate({
      filter: (match) => match.routeId === "/session/$sessionId",
    });
  }, [router, turnStarted]);

  return (
    <>
      {!turnStarted ? (
        <div className="mx-auto w-full max-w-4xl min-w-80 px-4 pt-2">
          <SessionStartProgress mode={workspaceMode} />
        </div>
      ) : null}
      {children}
    </>
  );
}
