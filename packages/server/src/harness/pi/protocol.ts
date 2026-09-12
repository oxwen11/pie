import type {
  JsonAgentSessionEvent,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcSessionState,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

// Pi's RPC wire protocol (JSON lines over stdio). The child is pie-owned
// (`harness/pi/rpc`); types still come from the published package because they
// match the vendored command table at the current pin. All imports here are
// type-only. The RPC child process is the only path for sessions; model
// catalog lookup (`list-available-models.ts`) uses the library in-process.
//
// stdout frames:
//   • `{ type: "response", command, success, ... }`  — reply to a stdin command
//   • `{ type: "extension_ui_request", ... }`        — extension UI sub-protocol
//   • everything else                                 — a JsonAgentSessionEvent
// The JSON shape intentionally omits cumulative message snapshots from
// message_update; using the in-process AgentSessionEvent type hides that gap.
export type AgentSessionEvent = JsonAgentSessionEvent;

export type {
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcSessionState,
  SessionEntry,
  SessionMessageEntry,
};

/** `get_entries` response data: the session's whole entry tree plus its leaf. */
export type SessionEntries = {
  readonly entries: ReadonlyArray<SessionEntry>;
  readonly leafId: string | null;
};

/**
 * The extension-UI methods that block the agent until the host replies with an
 * `extension_ui_response`. The rest (notify/setStatus/setWidget/…) are
 * fire-and-forget display hints.
 */
export type PiUiRequest = Extract<
  RpcExtensionUIRequest,
  { method: "confirm" | "select" | "input" | "editor" }
>;

const BLOCKING_UI_METHODS = new Set(["confirm", "select", "input", "editor"]);

export function isBlockingUiRequest(request: unknown): request is PiUiRequest {
  if (typeof request !== "object" || request === null) return false;
  if (!("type" in request) || request.type !== "extension_ui_request") return false;
  if (!("method" in request) || typeof request.method !== "string") return false;
  return BLOCKING_UI_METHODS.has(request.method);
}
