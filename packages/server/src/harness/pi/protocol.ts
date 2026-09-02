import type {
  JsonAgentSessionEvent,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcSessionState,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

// Pi's RPC wire protocol (`pi --mode rpc`, JSON lines over stdio). Unlike
// previous agents, the types come straight from the published package — pi is
// TypeScript-native, so there is no vendored ts-rs output. All imports here
// are type-only. The RPC child process is the only path for sessions; model
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

export function isBlockingUiRequest(request: RpcExtensionUIRequest): request is PiUiRequest {
  return BLOCKING_UI_METHODS.has(request.method);
}
