import type { SessionRef, SessionScopedEvent, SubscribeStreamEvent } from "@getpie/contract";
import { isSessionScopedEvent } from "@getpie/contract/session-events";

import { isAbortError, sleep } from "@/lib/utils";

export const PI_SESSION_EVENT = "pi.session.event";

const RESUBSCRIBE_DELAY_MS = 1000;
const PENDING_CAP = 64;

export type PluginPiSessionMessage = {
  readonly type: typeof PI_SESSION_EVENT;
  readonly ref: SessionRef;
  readonly event: SessionScopedEvent;
};

export type PluginSessionSubscribe = (
  input: { readonly scope: { readonly kind: "session"; readonly ref: SessionRef } },
  options: { readonly signal: AbortSignal },
) => Promise<AsyncIterable<SubscribeStreamEvent>>;

export type PluginFrame = {
  readonly contentWindow: {
    readonly postMessage: (message: unknown, targetOrigin: string) => void;
  } | null;
};

export type PluginMessagePort = {
  readonly deliver: (message: PluginPiSessionMessage) => void;
  readonly markReady: () => void;
};

export type PluginSessionBridge = {
  readonly detach: () => void;
};

/** Session-scoped Pi activity only. Pie collection events (created/renamed/…) stay out. */
export function pluginSessionMessage(
  ref: SessionRef,
  incoming: SubscribeStreamEvent,
): PluginPiSessionMessage | null {
  if (incoming.type !== "event") return null;
  if (!isSessionScopedEvent(incoming.event)) return null;
  return { type: PI_SESSION_EVENT, ref, event: incoming.event };
}

export function createPluginMessagePort(frame: PluginFrame): PluginMessagePort {
  const pending: PluginPiSessionMessage[] = [];
  let ready = false;

  const flush = () => {
    const win = frame.contentWindow;
    if (!ready || win === null) return;
    for (const message of pending) win.postMessage(message, "*");
    pending.length = 0;
  };

  return {
    deliver: (message) => {
      if (!ready || frame.contentWindow === null) {
        pending.push(message);
        if (pending.length > PENDING_CAP) pending.shift();
        return;
      }
      frame.contentWindow.postMessage(message, "*");
    },
    markReady: () => {
      ready = true;
      flush();
    },
  };
}

export function attachPluginSessionBridge(options: {
  readonly subscribe: PluginSessionSubscribe;
  readonly ref: SessionRef;
  readonly deliver: (message: PluginPiSessionMessage) => void;
}): PluginSessionBridge {
  const abort = new AbortController();

  const run = async () => {
    while (!abort.signal.aborted) {
      try {
        const stream = await options.subscribe(
          { scope: { kind: "session", ref: options.ref } },
          { signal: abort.signal },
        );
        for await (const incoming of stream) {
          if (abort.signal.aborted) return;
          const message = pluginSessionMessage(options.ref, incoming);
          if (message !== null) options.deliver(message);
        }
      } catch (error) {
        if (abort.signal.aborted || isAbortError(error)) return;
      }
      if (abort.signal.aborted) return;
      await sleep(RESUBSCRIBE_DELAY_MS, abort.signal);
    }
  };

  void run();
  return { detach: () => abort.abort() };
}
