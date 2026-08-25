import { Shimmer } from "@getpie/ui/ai-elements/shimmer";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import type { PendingSessionStart } from "@/features/chat/pending-session-start";
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
  const chat = useChatHandle(pending.ref);
  const router = useRouter();
  const status = useStore(chat.store, (state) => state.status);
  const [workspaceMode] = useState(pending.workspaceMode);

  useEffect(() => {
    void chat.tryBootstrapPrompt(pending.text).then((sent) => {
      if (!sent) return;
      void router.navigate({
        from: "/session/$sessionId",
        to: ".",
        replace: true,
        resetScroll: false,
        state: (prev) =>
          prev.pendingSessionStart === undefined
            ? prev
            : { ...prev, pendingSessionStart: undefined },
      });
    });
  }, [chat, pending.text, router]);

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
