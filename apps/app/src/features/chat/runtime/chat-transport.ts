import { ORPCError } from "@orpc/client";
import type { VibestClient } from "@vibest/client";
import type {
  PermissionMode,
  PromptPart,
  ReasoningEffort,
  SessionRef,
  SubscribeStreamEvent,
} from "@vibest/contract";
import { isSessionScopedEvent } from "@vibest/contract";
import type { UIMessage } from "ai";

import type { AgentResponse } from "./agent-requests";
import type { ChatSessionTransport, ChatTransportEvent } from "./chat-transport-port";

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

type VibestSessionClient = VibestClient["session"];

type SessionClient = Pick<
  VibestSessionClient,
  | "prompt"
  | "respondToAgentRequest"
  | "setReasoningEffort"
  | "setModel"
  | "setPermissionMode"
  | "getSnapshot"
  | "getMessages"
> & {
  subscribe: (
    ...args: Parameters<VibestSessionClient["subscribe"]>
  ) => Promise<AsyncIterable<SubscribeStreamEvent>>;
};

export type ChatTransportClient = {
  readonly session: SessionClient;
};

// One transport per Chat, bound to that session's SessionRef. The ref stays an
// object end to end; nothing here parses it out of a string.
//
// Deliberately thin: it moves wire events and RPC calls, and owns exactly one
// piece of protocol knowledge — how to recover a dropped subscription
// (re-subscribe, re-snapshot, emit a fresh "attached"). Everything stateful
// about the session (cursor, folds, pending requests, reconcile policy) lives
// in Chat.
export class OrpcChatSessionTransport implements ChatSessionTransport {
  readonly #ref: SessionRef;

  constructor(
    private readonly client: ChatTransportClient,
    sessionRef: SessionRef,
  ) {
    this.#ref = sessionRef;
  }

  subscribe(onEvent: (event: ChatTransportEvent) => void): () => void {
    const outer = new AbortController();
    // Each (re)subscription gets its own controller chained to the outer
    // signal — aborting is what actually cancels the oRPC event iterator.
    let closeCurrent: (() => void) | undefined;

    const openSubscription = async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (outer.signal.aborted) abort();
      else outer.signal.addEventListener("abort", abort, { once: true });
      try {
        const events = await this.client.session.subscribe(
          { scope: { kind: "session", ref: this.#ref } },
          { signal: controller.signal },
        );
        const close = () => {
          outer.signal.removeEventListener("abort", abort);
          abort();
        };
        return { events, close };
      } catch (error) {
        outer.signal.removeEventListener("abort", abort);
        throw error;
      }
    };

    const run = async () => {
      while (!outer.signal.aborted) {
        // Subscribe before the snapshot: an event landing between the two is
        // then waiting in the stream rather than lost, and the consumer's
        // cursor (seeded from the snapshot) drops the overlap.
        const subscription = await openSubscription();
        closeCurrent = subscription.close;
        let dropped = false;
        try {
          const snapshot = await this.client.session.getSnapshot({ ref: this.#ref });
          if (outer.signal.aborted) return;
          onEvent({ type: "attached", snapshot });
          for await (const item of subscription.events) {
            if (outer.signal.aborted) return;
            if (item.type === "closed") {
              // Server-side drop (slow consumer / teardown): recover by
              // re-attaching — the live stream has no replay.
              dropped = true;
              break;
            }
            if (isSessionScopedEvent(item.event)) onEvent(item.event);
          }
        } finally {
          subscription.close();
        }
        if (!dropped) return;
      }
    };

    void run().catch((streamError) => {
      if (!isAbortError(streamError)) console.error("Session events stream error:", streamError);
    });

    return () => {
      outer.abort();
      closeCurrent?.();
    };
  }

  prompt = async (input: {
    readonly messageId: string;
    readonly parts: ReadonlyArray<PromptPart>;
  }): Promise<{ readonly turnId: string }> => {
    return await this.client.session.prompt({
      ref: this.#ref,
      parts: input.parts,
      messageId: input.messageId,
    });
  };

  getMessages = async (): Promise<readonly UIMessage[] | null> => {
    try {
      const result = await this.client.session.getMessages({ ref: this.#ref });
      return result.messages;
    } catch (error) {
      // Capability absence is a normal outcome, not a failure.
      if (error instanceof ORPCError && error.code === "UNSUPPORTED") return null;
      throw error;
    }
  };

  // NOT_FOUND here is "the request is no longer pending" — with several
  // clients on one session, that usually means another client answered first.
  // The outcome the responder wanted (request resolved) holds either way, so
  // it maps to success; the request.replied event closes the card everywhere.
  respondToAgentRequest = async (requestId: string, response: AgentResponse): Promise<void> => {
    try {
      await this.client.session.respondToAgentRequest({
        ref: this.#ref,
        requestId,
        response,
      });
    } catch (error) {
      if (error instanceof ORPCError && error.code === "NOT_FOUND") return;
      throw error;
    }
  };

  setModel = async (providerId: string, modelId: string): Promise<void> => {
    await this.client.session.setModel({ ref: this.#ref, providerId, modelId });
  };

  setReasoningEffort = async (reasoningEffort: ReasoningEffort): Promise<void> => {
    await this.client.session.setReasoningEffort({ ref: this.#ref, reasoningEffort });
  };

  setPermissionMode = async (permissionMode: PermissionMode): Promise<void> => {
    await this.client.session.setPermissionMode({ ref: this.#ref, permissionMode });
  };
}
