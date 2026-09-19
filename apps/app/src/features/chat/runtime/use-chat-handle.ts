import type { EnvironmentSessionRef } from "@/lib/session-ref";

import type { Chat } from "./chat";
import { useChatManager } from "./chat-context";
import type { ChatStoreState } from "./chat-state";

// Whether the turn is producing a reply (submitted / streaming). Used as a
// useStore selector so consumers that only care about this bit (the composer)
// don't re-render per streamed token.
export const selectTurnInProgress = (s: ChatStoreState): boolean =>
  s.status === "submitted" || s.status === "streaming";

// Get-or-create a Chat by SessionRef. Identity is the manager's Map — not React.
export function useChatHandle(sessionRef: EnvironmentSessionRef): Chat {
  return useChatManager().chatFor(sessionRef);
}
