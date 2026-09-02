import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// @vitest-environment jsdom
import type { AgentRequest } from "@/features/chat/runtime/agent-requests";
import { ChatState } from "@/features/chat/runtime/chat-state";

import { ChatSessionContext, type ChatSessionValue } from "../chat-session-context";
import { AgentRequestView } from "./agent-request";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const respondToRequest = vi.fn<ChatSessionValue["respondToRequest"]>();
const session: ChatSessionValue = {
  sessionId: "session-1",
  store: new ChatState().store,
  prompt: vi.fn<(text: string) => void>(),
  interrupt: vi.fn<() => Promise<void>>(async () => undefined),
  respondToRequest,
  turnInProgress: false,
};

const toolRequest: AgentRequest = {
  type: "tool",
  id: "request-1",
  toolName: "Bash",
  input: { command: "pwd" },
  actions: [{ id: "allow", label: "Allow", behavior: "allow" }],
  native: null,
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  respondToRequest.mockClear();
});

describe("AgentRequestView", () => {
  it("sends request responses through the chat session boundary", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        <ChatSessionContext.Provider value={session}>
          <AgentRequestView request={toolRequest} />
        </ChatSessionContext.Provider>,
      ),
    );

    const allowButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Allow"),
    );
    expect(allowButton).toBeDefined();

    act(() => allowButton?.click());

    expect(respondToRequest).toHaveBeenCalledWith("request-1", {
      type: "tool",
      selectedActionId: "allow",
      behavior: "allow",
      grant: undefined,
      interrupt: undefined,
    });
  });
});
