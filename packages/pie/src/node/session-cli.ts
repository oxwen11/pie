import path from "node:path";

import type { PieClient } from "@getpie/client";
import {
  AgentResponseSchema,
  type AgentRequest,
  type AgentResponse,
  type CreateWorktreeInput,
  type PieUIMessage,
  type PromptDelivery,
  type PromptPart,
  type ScheduleSpec,
  type SessionRef,
  type SubscribeStreamEvent,
} from "@getpie/contract";
import { parseSessionPullRequestUrl } from "@getpie/contract/pull-request";
import { deriveMcpToken, MCP_PATH } from "@getpie/server/http";
import { Effect, Option, Runtime, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import {
  type PieEndpoint,
  createPieClientFromEndpoint,
  describeConnectFailure,
  resolvePieEndpoint,
  urlFlag,
} from "./connect";

const projectIdFlag = () =>
  Flag.String("project-id").pipe(
    Flag.withDescription(
      "Registered project id (default: PIE_PROJECT_ID, else look up/create for --cwd / cwd)",
    ),
    Flag.optional,
  );

const cwdFlag = () =>
  Flag.String("cwd").pipe(
    Flag.withDescription("Project directory used when --project-id is omitted (default: cwd)"),
    Flag.optional,
  );

const sessionIdFlag = () =>
  Flag.String("session-id").pipe(
    Flag.withDescription("Reuse an existing session (also PIE_SESSION_ID)"),
    Flag.optional,
  );

const providerFlag = () =>
  Flag.String("provider").pipe(Flag.withDescription("Model provider"), Flag.optional);

const modelIdFlag = () =>
  Flag.String("model-id").pipe(
    Flag.withDescription("Model id (must be passed with --provider)"),
    Flag.optional,
  );

const worktreeFlag = () =>
  Flag.Boolean("worktree").pipe(
    Flag.withDescription("Create a git worktree for this session (branch name is server-assigned)"),
    Flag.withDefault(false),
  );

const worktreeBaseFlag = () =>
  Flag.String("worktree-base").pipe(
    Flag.withDescription("Ref to branch the worktree from (implies --worktree; default HEAD)"),
    Flag.optional,
  );

const jsonFlag = () =>
  Flag.Boolean("json").pipe(
    Flag.withDescription("Print contract-shaped JSON on stdout"),
    Flag.withDefault(false),
  );

const quietFlag = () =>
  Flag.Boolean("q").pipe(
    Flag.withAlias("quiet"),
    Flag.withDescription("Print only the primary id"),
    Flag.withDefault(false),
  );

const noWaitFlag = () =>
  Flag.Boolean("no-wait").pipe(
    Flag.withDescription("Return after the prompt is accepted"),
    Flag.withDefault(false),
  );

const timeoutFlag = () =>
  Flag.String("timeout").pipe(
    Flag.withDescription("Max wait duration (e.g. 30s, 5m, 1h; default 30m)"),
    Flag.optional,
  );

const tailFlag = () =>
  Flag.Int("tail").pipe(Flag.withDescription("Only the last N messages"), Flag.optional);

const sessionIdArg = () =>
  Argument.String("session-id").pipe(
    Argument.withDescription("Session id (default: PIE_SESSION_ID)"),
    Argument.optional,
  );

const failFrom = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const run = (action: () => Promise<void>) => Effect.tryPromise({ try: action, catch: failFrom });

const emptyToUndefined = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value;

export type WaitState =
  | { readonly kind: "idle" }
  | { readonly kind: "request"; readonly requestId: string; readonly request: AgentRequest }
  | { readonly kind: "crashed" };

class WaitTimeoutError extends Error {
  override readonly [Runtime.errorExitCode] = 1;
  override name = "WaitTimeoutError";
  constructor(timeoutMs: number) {
    super(`timed out after ${formatDuration(timeoutMs)}`);
  }
}

class RequestPendingError extends Error {
  override readonly [Runtime.errorExitCode] = 1;
  override name = "RequestPendingError";
  readonly requestId: string;
  constructor(requestId: string) {
    super(
      `session requires action; respond with: pie session respond <session-id> --request ${requestId} …`,
    );
    this.requestId = requestId;
  }
}

class SessionCrashedError extends Error {
  override readonly [Runtime.errorExitCode] = 1;
  override name = "SessionCrashedError";
  constructor() {
    super("session crashed");
  }
}

export function parseDuration(raw: string): number {
  const match = /^(\d+)(ms|s|m|h)?$/i.exec(raw.trim());
  if (match === null) {
    throw new Error(`invalid duration: ${raw} (use Ns, Nm, Nh, or Nms)`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
    default:
      throw new Error(`invalid duration: ${raw}`);
  }
}

const formatDuration = (ms: number): string => {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
};

const DEFAULT_TIMEOUT_MS = 30 * 60_000;

const resolveTimeoutMs = (timeout: Option.Option<string>): number =>
  Option.isSome(timeout) ? parseDuration(timeout.value) : DEFAULT_TIMEOUT_MS;

type OutputMode = {
  readonly json: boolean;
  readonly quiet: boolean;
};

const writeStdout = (text: string) => {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
};

const printJson = (value: unknown) => {
  writeStdout(JSON.stringify(value));
};

const printRef = (ref: SessionRef, mode: OutputMode) => {
  if (mode.json) {
    printJson({ sessionId: ref.sessionId, projectId: ref.projectId });
    return;
  }
  if (mode.quiet) {
    writeStdout(ref.sessionId);
    return;
  }
  writeStdout(`${ref.sessionId}\t${ref.projectId}`);
};

const printWaitState = (state: WaitState, mode: OutputMode) => {
  if (mode.json) {
    if (state.kind === "request") {
      printJson({ state: "request", requestId: state.requestId, request: state.request });
      return;
    }
    printJson({ state: state.kind });
    return;
  }
  if (state.kind === "request") {
    writeStdout(mode.quiet ? state.requestId : `request\t${state.requestId}`);
    return;
  }
  writeStdout(state.kind);
};

async function resolveProjectId(
  client: PieClient,
  projectId: Option.Option<string>,
  cwd: Option.Option<string>,
): Promise<string> {
  const fromFlag = Option.getOrUndefined(projectId);
  if (fromFlag !== undefined) return fromFlag;
  const fromEnv = emptyToUndefined(process.env.PIE_PROJECT_ID);
  if (fromEnv !== undefined) return fromEnv;
  const workspace = path.resolve(Option.getOrElse(cwd, () => process.cwd()));
  const project = await client.project.create({ path: workspace });
  return project.id;
}

async function resolveSessionRef(
  client: PieClient,
  sessionId: string,
  projectId: Option.Option<string>,
): Promise<SessionRef> {
  if (Option.isSome(projectId)) return { projectId: projectId.value, sessionId };
  const fromEnv = emptyToUndefined(process.env.PIE_PROJECT_ID);
  if (fromEnv !== undefined) return { projectId: fromEnv, sessionId };
  return client.session.resolveRef({ sessionId });
}

function requireSessionId(sessionId: Option.Option<string>): string {
  const value = Option.getOrUndefined(sessionId) ?? emptyToUndefined(process.env.PIE_SESSION_ID);
  if (value === undefined) {
    throw new Error("session-id required (pass it or set PIE_SESSION_ID)");
  }
  return value;
}

async function withClient<A>(
  endpoint: PieEndpoint,
  body: (client: PieClient) => Promise<A>,
): Promise<A> {
  const { client, close } = createPieClientFromEndpoint(endpoint);
  try {
    return await body(client);
  } catch (error) {
    throw describeConnectFailure(error, endpoint);
  } finally {
    close();
  }
}

const pairedModel = (
  provider: Option.Option<string>,
  modelId: Option.Option<string>,
): { readonly provider: string; readonly modelId: string } | undefined => {
  const providerValue = Option.getOrUndefined(provider);
  const modelIdValue = Option.getOrUndefined(modelId);
  if (providerValue === undefined && modelIdValue === undefined) return undefined;
  if (providerValue === undefined || modelIdValue === undefined) {
    throw new Error("--provider and --model-id must be passed together");
  }
  return { provider: providerValue, modelId: modelIdValue };
};

const worktreeInput = (
  enabled: boolean,
  base: Option.Option<string>,
): CreateWorktreeInput | undefined => {
  if (Option.isSome(base)) return { base: base.value };
  if (enabled) return {};
  return undefined;
};

const stateFromSnapshot = (snapshot: {
  readonly status: { readonly phase: string };
  readonly pendingRequests: ReadonlyArray<AgentRequest>;
}): WaitState => {
  const pending = snapshot.pendingRequests[0];
  if (pending !== undefined) {
    return { kind: "request", requestId: pending.id, request: pending };
  }
  if (snapshot.status.phase === "crashed") return { kind: "crashed" };
  if (snapshot.status.phase === "requires_action") {
    throw new Error("session requires action but pendingRequests is empty");
  }
  return { kind: "idle" };
};

/** Watch a live subscribe stream until the current turn settles or a request appears. */
export async function awaitTurn(
  stream: AsyncIterable<SubscribeStreamEvent>,
): Promise<Exclude<WaitState, { kind: "crashed" }>> {
  for await (const item of stream) {
    if (item.type === "closed") {
      throw new Error(`session stream closed (${item.reason})`);
    }
    const event = item.event;
    if (event.type === "session.request.asked") {
      return { kind: "request", requestId: event.request.id, request: event.request };
    }
    if (event.type === "session.turn.ended") {
      return { kind: "idle" };
    }
    if (event.type === "session.closed") {
      throw new Error("session closed");
    }
  }
  throw new Error("session stream ended");
}

const withTimeout = async <A>(promise: Promise<A>, timeoutMs: number): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<A>((_resolve, reject) => {
        timer = setTimeout(() => reject(new WaitTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

async function readWaitState(client: PieClient, ref: SessionRef): Promise<WaitState | "running"> {
  const snapshot = await client.session.getSnapshot({ ref });
  if (snapshot.pendingRequests[0] !== undefined || snapshot.status.phase === "requires_action") {
    return stateFromSnapshot(snapshot);
  }
  if (snapshot.status.phase === "crashed") return { kind: "crashed" };
  if (snapshot.status.phase === "running" || snapshot.status.activeTurnId !== undefined) {
    return "running";
  }
  return { kind: "idle" };
}

async function waitForSession(
  client: PieClient,
  ref: SessionRef,
  timeoutMs: number,
): Promise<WaitState> {
  // Subscribe before reading, so a turn that ends in between is still seen.
  const stream = await client.session.subscribe({
    scope: { kind: "session", ref },
  });
  const initial = await readWaitState(client, ref);
  if (initial !== "running") {
    await stream[Symbol.asyncIterator]().return?.();
    return initial;
  }
  const settled = await withTimeout(awaitTurn(stream), timeoutMs);
  if (settled.kind === "request") return settled;
  // turn.ended can race a late request; re-check snapshot once.
  return readWaitState(client, ref).then((state) => {
    if (state === "running") return { kind: "idle" };
    return state;
  });
}

/** The prompt parts: just the text, or budgeted history from `--from` followed by it. */
async function promptParts(
  client: PieClient,
  text: string,
  from: Option.Option<string>,
): Promise<ReadonlyArray<PromptPart>> {
  if (Option.isNone(from)) return [{ type: "text", text }];
  // Resolved by id alone, so --project-id / PIE_PROJECT_ID cannot misaddress the source.
  const source = await client.session.resolveRef({ sessionId: from.value });
  const { parts } = await client.session.handoff({ from: source, prompt: text });
  return parts;
}

const deliveryFlag = () =>
  Flag.Literals("delivery", ["steer", "followUp"] as const).pipe(
    Flag.withDescription(
      "While a turn is running: steer before the next model call, or queue a follow-up (default)",
    ),
    Flag.optional,
  );

const fromFlag = () =>
  Flag.String("from").pipe(
    Flag.withDescription(
      "Copy budgeted history (user/assistant text, command results) from this session id into the prompt; fails without creating anything if it does not fit",
    ),
    Flag.optional,
  );

async function promptAndOptionallyWait(
  client: PieClient,
  ref: SessionRef,
  parts: ReadonlyArray<PromptPart>,
  noWait: boolean,
  timeoutMs: number,
  delivery?: PromptDelivery,
): Promise<WaitState | undefined> {
  const input = {
    ref,
    parts,
    ...(delivery !== undefined ? { delivery } : undefined),
  };
  if (noWait) {
    await client.send(input);
    return undefined;
  }
  const stream = await client.session.subscribe({
    scope: { kind: "session", ref },
  });
  await client.send(input);
  const settled = await withTimeout(awaitTurn(stream), timeoutMs);
  if (settled.kind === "request") return settled;
  const again = await readWaitState(client, ref);
  if (again === "running") return { kind: "idle" };
  return again;
}

const textFromMessage = (message: PieUIMessage): string =>
  message.parts
    .map((part) => {
      if (part.type === "text") return part.text;
      return "";
    })
    .filter((part) => part.length > 0)
    .join("");

const printLogs = (messages: ReadonlyArray<PieUIMessage>, mode: OutputMode) => {
  if (mode.json) {
    printJson({ messages });
    return;
  }
  for (const message of messages) {
    const text = textFromMessage(message).replaceAll(/\s+/g, " ").trim();
    if (mode.quiet) {
      writeStdout(message.id);
      continue;
    }
    writeStdout(`${message.role}\t${text}`);
  }
};

const buildAllowDenyResponse = (
  request: AgentRequest,
  behavior: "allow" | "deny",
): AgentResponse => {
  if (request.type === "tool") {
    const selected =
      request.actions.find((action) => action.behavior === behavior) ?? request.actions[0];
    return {
      type: "tool",
      behavior,
      ...(selected !== undefined ? { selectedActionId: selected.id } : undefined),
    };
  }
  if (request.type === "plan") {
    return { type: "plan", behavior };
  }
  throw new Error("question requests require --response <json>");
};

const outputFlags = {
  json: jsonFlag(),
  quiet: quietFlag(),
  url: urlFlag(),
};

export const runCommand = Command.make(
  "run",
  {
    text: Argument.String("text").pipe(Argument.withDescription("Prompt text")),
    projectId: projectIdFlag(),
    cwd: cwdFlag(),
    sessionId: sessionIdFlag(),
    provider: providerFlag(),
    modelId: modelIdFlag(),
    worktree: worktreeFlag(),
    worktreeBase: worktreeBaseFlag(),
    from: fromFlag(),
    noWait: noWaitFlag(),
    timeout: timeoutFlag(),
    ...outputFlags,
  },
  (input) =>
    Effect.gen(function* () {
      const endpoint = yield* resolvePieEndpoint(input.url);
      const mode = { json: input.json, quiet: input.quiet };
      const timeoutMs = resolveTimeoutMs(input.timeout);
      yield* run(async () => {
        await withClient(endpoint, async (client) => {
          const model = pairedModel(input.provider, input.modelId);
          const worktree = worktreeInput(input.worktree, input.worktreeBase);
          const reuseSessionId =
            Option.getOrUndefined(input.sessionId) ?? emptyToUndefined(process.env.PIE_SESSION_ID);
          let ref: SessionRef;
          let createdWorktree: { readonly cwd: string; readonly branch: string } | undefined;
          if (reuseSessionId !== undefined) {
            if (worktree !== undefined) {
              throw new Error("--worktree only applies when creating a session");
            }
            ref = await resolveSessionRef(client, reuseSessionId, input.projectId);
            if (model !== undefined) {
              await client.session.model({
                ref,
                provider: model.provider,
                modelId: model.modelId,
              });
            }
          } else {
            const projectId = await resolveProjectId(client, input.projectId, input.cwd);
            const from = Option.isNone(input.from)
              ? undefined
              : await client.session.resolveRef({ sessionId: input.from.value });
            const created = await client.run({
              projectId,
              prompt: input.text,
              ...(from !== undefined ? { from } : undefined),
              ...(model !== undefined
                ? { provider: model.provider, modelId: model.modelId }
                : undefined),
              ...(worktree !== undefined ? { worktree } : undefined),
            });
            ref = created.ref;
            if (created.workspace.worktree !== undefined) {
              createdWorktree = {
                cwd: created.workspace.cwd,
                branch: created.workspace.worktree.branch,
              };
            }
          }

          // Ids first so --no-wait and early failures still yield a chainable ref.
          if (!mode.json) printRef(ref, mode);

          const state =
            reuseSessionId === undefined
              ? input.noWait
                ? undefined
                : await waitForSession(client, ref, timeoutMs)
              : await promptAndOptionallyWait(
                  client,
                  ref,
                  await promptParts(client, input.text, input.from),
                  input.noWait,
                  timeoutMs,
                );

          if (mode.json) {
            printJson({
              sessionId: ref.sessionId,
              projectId: ref.projectId,
              ...(createdWorktree !== undefined ? { worktree: createdWorktree } : undefined),
              ...(state === undefined
                ? { state: "accepted" }
                : state.kind === "request"
                  ? { state: "request", requestId: state.requestId, request: state.request }
                  : { state: state.kind }),
            });
          } else if (state?.kind === "request" && !mode.quiet) {
            writeStdout(`request\t${state.requestId}`);
          }

          if (state?.kind === "request") throw new RequestPendingError(state.requestId);
          if (state?.kind === "crashed") throw new SessionCrashedError();
        });
      });
    }),
).pipe(
  Command.withDescription(
    "Create a session (or reuse --session-id), send a prompt, print ids; waits unless --no-wait",
  ),
);

export const waitCommand = Command.make(
  "wait",
  {
    sessionId: sessionIdArg(),
    projectId: projectIdFlag(),
    timeout: timeoutFlag(),
    ...outputFlags,
  },
  (input) =>
    Effect.gen(function* () {
      const endpoint = yield* resolvePieEndpoint(input.url);
      const mode = { json: input.json, quiet: input.quiet };
      const timeoutMs = resolveTimeoutMs(input.timeout);
      yield* run(async () => {
        await withClient(endpoint, async (client) => {
          const ref = await resolveSessionRef(
            client,
            requireSessionId(input.sessionId),
            input.projectId,
          );
          const state = await waitForSession(client, ref, timeoutMs);
          if (state.kind === "crashed") {
            printWaitState(state, mode);
            throw new SessionCrashedError();
          }
          printWaitState(state, mode);
        });
      });
    }),
).pipe(Command.withDescription("Wait until the session is idle or requires action"));

export const logsCommand = Command.make(
  "logs",
  {
    sessionId: sessionIdArg(),
    projectId: projectIdFlag(),
    tail: tailFlag(),
    ...outputFlags,
  },
  (input) =>
    Effect.gen(function* () {
      const endpoint = yield* resolvePieEndpoint(input.url);
      const mode = { json: input.json, quiet: input.quiet };
      yield* run(async () => {
        await withClient(endpoint, async (client) => {
          const ref = await resolveSessionRef(
            client,
            requireSessionId(input.sessionId),
            input.projectId,
          );
          const { messages } = await client.logs({ ref });
          const tail = Option.getOrUndefined(input.tail);
          const sliced = tail === undefined ? messages : messages.slice(-tail);
          printLogs(sliced, mode);
        });
      });
    }),
).pipe(Command.withDescription("Print session messages"));

export const sendCommand = Command.make(
  "send",
  {
    sessionId: sessionIdArg(),
    text: Argument.String("text").pipe(Argument.withDescription("Prompt text")),
    projectId: projectIdFlag(),
    delivery: deliveryFlag(),
    from: fromFlag(),
    noWait: noWaitFlag(),
    timeout: timeoutFlag(),
    ...outputFlags,
  },
  (input) =>
    Effect.gen(function* () {
      const endpoint = yield* resolvePieEndpoint(input.url);
      const mode = { json: input.json, quiet: input.quiet };
      const timeoutMs = resolveTimeoutMs(input.timeout);
      yield* run(async () => {
        await withClient(endpoint, async (client) => {
          const ref = await resolveSessionRef(
            client,
            requireSessionId(input.sessionId),
            input.projectId,
          );
          const parts = await promptParts(client, input.text, input.from);
          if (!mode.json) printRef(ref, mode);
          const state = await promptAndOptionallyWait(
            client,
            ref,
            parts,
            input.noWait,
            timeoutMs,
            Option.getOrUndefined(input.delivery),
          );
          if (mode.json) {
            printJson({
              sessionId: ref.sessionId,
              projectId: ref.projectId,
              ...(state === undefined
                ? { state: "accepted" }
                : state.kind === "request"
                  ? { state: "request", requestId: state.requestId, request: state.request }
                  : { state: state.kind }),
            });
          } else if (state?.kind === "request" && !mode.quiet) {
            writeStdout(`request\t${state.requestId}`);
          }
          if (state?.kind === "request") throw new RequestPendingError(state.requestId);
          if (state?.kind === "crashed") throw new SessionCrashedError();
        });
      });
    }),
).pipe(Command.withDescription("Send a prompt to an existing session"));

export const respondCommand = Command.make(
  "respond",
  {
    sessionId: sessionIdArg(),
    projectId: projectIdFlag(),
    requestId: Flag.String("request").pipe(Flag.withDescription("Pending request id")),
    responseJson: Flag.String("response").pipe(
      Flag.withDescription("AgentResponse JSON object"),
      Flag.optional,
    ),
    allow: Flag.Boolean("allow").pipe(
      Flag.withDescription("Allow a tool/plan request"),
      Flag.withDefault(false),
    ),
    deny: Flag.Boolean("deny").pipe(
      Flag.withDescription("Deny a tool/plan request"),
      Flag.withDefault(false),
    ),
    ...outputFlags,
  },
  (input) =>
    Effect.gen(function* () {
      const endpoint = yield* resolvePieEndpoint(input.url);
      const mode = { json: input.json, quiet: input.quiet };
      yield* run(async () => {
        await withClient(endpoint, async (client) => {
          if (input.allow && input.deny) throw new Error("pass only one of --allow or --deny");
          const ref = await resolveSessionRef(
            client,
            requireSessionId(input.sessionId),
            input.projectId,
          );
          let response: AgentResponse;
          if (Option.isSome(input.responseJson)) {
            response = Schema.decodeUnknownSync(AgentResponseSchema)(
              JSON.parse(input.responseJson.value),
            );
          } else if (input.allow || input.deny) {
            const snapshot = await client.session.getSnapshot({ ref });
            const request = snapshot.pendingRequests.find((item) => item.id === input.requestId);
            if (request === undefined) {
              throw new Error(`pending request not found: ${input.requestId}`);
            }
            response = buildAllowDenyResponse(request, input.allow ? "allow" : "deny");
          } else {
            throw new Error("pass --response <json>, or --allow / --deny");
          }
          await client.session.respond({
            ref,
            requestId: input.requestId,
            response,
          });
          if (mode.json)
            printJson({ sessionId: ref.sessionId, projectId: ref.projectId, ok: true });
          else if (mode.quiet) writeStdout(ref.sessionId);
          else writeStdout(`${ref.sessionId}\t${ref.projectId}`);
        });
      });
    }),
).pipe(Command.withDescription("Respond to a pending agent request"));

export const interruptCommand = Command.make(
  "interrupt",
  {
    sessionId: sessionIdArg(),
    projectId: projectIdFlag(),
    ...outputFlags,
  },
  (input) =>
    Effect.gen(function* () {
      const endpoint = yield* resolvePieEndpoint(input.url);
      const mode = { json: input.json, quiet: input.quiet };
      yield* run(async () => {
        await withClient(endpoint, async (client) => {
          const ref = await resolveSessionRef(
            client,
            requireSessionId(input.sessionId),
            input.projectId,
          );
          await client.interrupt({ ref });
          if (mode.json)
            printJson({ sessionId: ref.sessionId, projectId: ref.projectId, ok: true });
          else if (mode.quiet) writeStdout(ref.sessionId);
          else writeStdout(`${ref.sessionId}\t${ref.projectId}`);
        });
      });
    }),
).pipe(Command.withDescription("Interrupt the in-flight turn"));

export const lsCommand = Command.make(
  "ls",
  {
    projectId: projectIdFlag(),
    cwd: cwdFlag(),
    all: Flag.Boolean("all").pipe(
      Flag.withAlias("a"),
      Flag.withDescription("Include archived sessions"),
      Flag.withDefault(false),
    ),
    ...outputFlags,
  },
  (input) =>
    Effect.gen(function* () {
      const endpoint = yield* resolvePieEndpoint(input.url);
      const mode = { json: input.json, quiet: input.quiet };
      yield* run(async () => {
        await withClient(endpoint, async (client) => {
          const projectId = await resolveProjectId(client, input.projectId, input.cwd);
          const active = await client.ls({ projectId, archived: false });
          const sessions = input.all
            ? [...active, ...(await client.ls({ projectId, archived: true }))]
            : active;
          if (mode.json) {
            printJson(sessions);
            return;
          }
          for (const session of sessions) {
            if (mode.quiet) {
              writeStdout(session.sessionId);
              continue;
            }
            writeStdout(
              `${session.sessionId}\t${session.archived ? "archived" : "active"}\t${session.title ?? ""}`,
            );
          }
        });
      });
    }),
).pipe(Command.withDescription("List sessions in a project"));

type SessionInput = {
  readonly sessionId: Option.Option<string>;
  readonly projectId: Option.Option<string>;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly url: Option.Option<string>;
};

/** Resolve the endpoint and the target session, then run one action against it. */
const onSession = (
  input: SessionInput,
  act: (client: PieClient, ref: SessionRef, mode: OutputMode) => Promise<void>,
) =>
  Effect.gen(function* () {
    const endpoint = yield* resolvePieEndpoint(input.url);
    const mode = { json: input.json, quiet: input.quiet };
    yield* run(async () => {
      await withClient(endpoint, async (client) => {
        const ref = await resolveSessionRef(
          client,
          requireSessionId(input.sessionId),
          input.projectId,
        );
        await act(client, ref, mode);
      });
    });
  });

const printOk = (ref: SessionRef, mode: OutputMode) => {
  if (mode.json) printJson({ sessionId: ref.sessionId, projectId: ref.projectId, ok: true });
  else printRef(ref, mode);
};

export const renameCommand = Command.make(
  "rename",
  {
    sessionId: sessionIdArg(),
    title: Argument.String("title").pipe(
      Argument.withDescription("New title (max 120 characters)"),
    ),
    projectId: projectIdFlag(),
    ...outputFlags,
  },
  (input) =>
    onSession(input, async (client, ref, mode) => {
      await client.session.rename({ ref, title: input.title });
      printOk(ref, mode);
    }),
).pipe(Command.withDescription("Rename a session"));

export const modelCommand = Command.make(
  "model",
  {
    sessionId: sessionIdArg(),
    projectId: projectIdFlag(),
    provider: providerFlag(),
    modelId: modelIdFlag(),
    ...outputFlags,
  },
  (input) =>
    onSession(input, async (client, ref, mode) => {
      const model = pairedModel(input.provider, input.modelId);
      const state =
        model === undefined
          ? await client.session.getModelState({ ref })
          : await client.session.model({
              ref,
              provider: model.provider,
              modelId: model.modelId,
            });
      if (mode.json) printJson(state);
      else writeStdout(`${state.provider ?? ""}\t${state.modelId ?? ""}`);
    }),
).pipe(
  Command.withDescription(
    "Print a session's model, or set it with --provider and --model-id (setting persists Pi's default)",
  ),
);

export const queueCommand = Command.make(
  "queue",
  {
    sessionId: sessionIdArg(),
    projectId: projectIdFlag(),
    steering: Flag.String("steering").pipe(
      Flag.withDescription("A steering prompt (repeatable)"),
      Flag.atLeast(0),
    ),
    followUp: Flag.String("follow-up").pipe(
      Flag.withDescription("A follow-up prompt (repeatable)"),
      Flag.atLeast(0),
    ),
    ...outputFlags,
  },
  (input) =>
    onSession(input, async (client, ref, mode) => {
      await client.session.queue({
        ref,
        steering: input.steering,
        followUp: input.followUp,
      });
      printOk(ref, mode);
    }),
).pipe(
  Command.withDescription(
    "Replace the whole prompt queue with the given --steering/--follow-up prompts; none clears it",
  ),
);

export const archiveCommand = Command.make(
  "archive",
  {
    sessionId: sessionIdArg(),
    projectId: projectIdFlag(),
    undo: Flag.Boolean("undo").pipe(
      Flag.withDescription("Restore an archived session"),
      Flag.withDefault(false),
    ),
    ...outputFlags,
  },
  (input) =>
    onSession(input, async (client, ref, mode) => {
      await client.session.archive({ ref, archived: !input.undo });
      printOk(ref, mode);
    }),
).pipe(Command.withDescription("Archive a session (--undo restores it)"));

const prUrlArg = () =>
  Argument.String("url").pipe(Argument.withDescription("Exact HTTPS GitHub pull request URL"));

const prLink = Command.make(
  "link",
  {
    sessionId: sessionIdArg(),
    pr: prUrlArg(),
    projectId: projectIdFlag(),
    restore: Flag.Boolean("restore").pipe(
      Flag.withDescription("Restore an excluded association"),
      Flag.withDefault(false),
    ),
    ...outputFlags,
  },
  (input) =>
    onSession(input, async (client, ref, mode) => {
      const status = await client.pr.link({
        ref,
        pullRequest: parseSessionPullRequestUrl(input.pr),
        ...(input.restore ? { restore: true } : undefined),
      });
      if (mode.json) printJson({ sessionId: ref.sessionId, projectId: ref.projectId, status });
      else writeStdout(status);
    }),
).pipe(
  Command.withDescription("Save a known PR association for a session without querying GitHub"),
);

const prLs = Command.make(
  "ls",
  { sessionId: sessionIdArg(), projectId: projectIdFlag(), ...outputFlags },
  (input) =>
    onSession(input, async (client, ref, mode) => {
      const [status] = await client.pr.ls({ refs: [ref] });
      const links = status?.links ?? [];
      if (mode.json) {
        printJson(links);
        return;
      }
      for (const link of links) {
        const { owner, repository, number } = link.ref;
        const id = `${owner}/${repository}#${number}`;
        writeStdout(mode.quiet ? id : `${id}\t${link.excluded ? "excluded" : "linked"}`);
      }
    }),
).pipe(Command.withDescription("List a session's saved PR associations"));

const prExclude = Command.make(
  "exclude",
  { sessionId: sessionIdArg(), pr: prUrlArg(), projectId: projectIdFlag(), ...outputFlags },
  (input) =>
    onSession(input, async (client, ref, mode) => {
      await client.pr.exclude({
        ref,
        pullRequest: parseSessionPullRequestUrl(input.pr),
      });
      printOk(ref, mode);
    }),
).pipe(Command.withDescription("Exclude a PR from a session; does not touch GitHub"));

export const prCommand = Command.make("pr", {}, () =>
  Effect.fail(new Error("usage: pie pr link|ls|exclude")),
).pipe(
  Command.withDescription("Session pull-request associations"),
  Command.withSubcommands([prLink, prLs, prExclude]),
);

// ---------------------------------------------------------------------------
// Schedules: the verbs are scheduleContract's, nothing more.
// ---------------------------------------------------------------------------

const scheduleIdArg = () =>
  Argument.String("schedule-id").pipe(Argument.withDescription("Schedule id"));

const specFlags = {
  cron: Flag.String("cron").pipe(Flag.withDescription("5-field cron expression"), Flag.optional),
  tz: Flag.String("tz").pipe(Flag.withDescription("IANA timezone for --cron"), Flag.optional),
  every: Flag.String("every").pipe(
    Flag.withDescription("Repeat interval, at least 1m (e.g. 30m, 2h)"),
    Flag.optional,
  ),
  at: Flag.String("at").pipe(
    Flag.withDescription("Run once at this timezone-aware ISO-8601 instant"),
    Flag.optional,
  ),
  manual: Flag.Boolean("manual").pipe(
    Flag.withDescription("Only run on demand (pie schedule run)"),
    Flag.withDefault(false),
  ),
};

const policyFlags = {
  sessionPolicy: Flag.Literals("session-policy", ["isolated", "owned", "existing"] as const).pipe(
    Flag.withDescription(
      "isolated: a new session per run; owned: one session the schedule creates and reuses; existing: prompt --session-id on every run",
    ),
    Flag.optional,
  ),
  sessionId: sessionIdFlag(),
};

const specFrom = (input: {
  readonly cron: Option.Option<string>;
  readonly tz: Option.Option<string>;
  readonly every: Option.Option<string>;
  readonly at: Option.Option<string>;
  readonly manual: boolean;
}): ScheduleSpec | undefined => {
  const given = [
    Option.isSome(input.cron),
    Option.isSome(input.every),
    Option.isSome(input.at),
    input.manual,
  ].filter(Boolean).length;
  if (given > 1) throw new Error("pass only one of --cron, --every, --at, --manual");
  if (Option.isSome(input.cron)) {
    return {
      kind: "cron",
      expr: input.cron.value,
      ...(Option.isSome(input.tz) ? { timeZone: input.tz.value } : undefined),
    };
  }
  if (Option.isSome(input.every))
    return { kind: "every", everyMs: parseDuration(input.every.value) };
  if (Option.isSome(input.at)) return { kind: "once", runAt: input.at.value };
  if (input.manual) return { kind: "manual" };
  return undefined;
};

const sessionPolicyFrom = (
  policy: Option.Option<"isolated" | "owned" | "existing">,
  sessionId: Option.Option<string>,
) => {
  if (Option.isNone(policy)) {
    if (Option.isSome(sessionId)) throw new Error("--session-id needs --session-policy existing");
    return undefined;
  }
  if (policy.value === "existing") {
    if (Option.isNone(sessionId)) throw new Error("--session-policy existing needs --session-id");
    return { policy: "existing" as const, sessionId: sessionId.value };
  }
  if (Option.isSome(sessionId)) {
    throw new Error("--session-id is only for --session-policy existing");
  }
  return { policy: policy.value };
};

const onClient = (
  input: { readonly url: Option.Option<string> },
  act: (client: PieClient) => Promise<void>,
) =>
  Effect.gen(function* () {
    const endpoint = yield* resolvePieEndpoint(input.url);
    yield* run(() => withClient(endpoint, act));
  });

const printSchedule = (
  schedule: {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly nextRunAt: string | null;
    readonly spec: ScheduleSpec;
  },
  mode: OutputMode,
) => {
  if (mode.json) printJson(schedule);
  else if (mode.quiet) writeStdout(schedule.id);
  else {
    writeStdout(
      `${schedule.id}\t${schedule.enabled ? "enabled" : "disabled"}\t${schedule.spec.kind}\t${schedule.nextRunAt ?? "-"}\t${schedule.name}`,
    );
  }
};

const scheduleList = Command.make("list", { ...outputFlags }, (input) =>
  onClient(input, async (client) => {
    const schedules = await client.schedule.list();
    if (input.json) printJson(schedules);
    else for (const schedule of schedules) printSchedule(schedule, input);
  }),
).pipe(Command.withDescription("List schedules"));

const scheduleGet = Command.make("get", { id: scheduleIdArg(), ...outputFlags }, (input) =>
  onClient(input, async (client) => {
    printSchedule(await client.schedule.get({ id: input.id }), input);
  }),
).pipe(Command.withDescription("Show one schedule"));

const scheduleCreate = Command.make(
  "create",
  {
    prompt: Argument.String("prompt").pipe(Argument.withDescription("Prompt each run sends")),
    name: Flag.String("name").pipe(Flag.withDescription("Schedule name (max 80 characters)")),
    projectId: projectIdFlag(),
    cwd: cwdFlag(),
    ...specFlags,
    ...policyFlags,
    maxRuns: Flag.Int("max-runs").pipe(
      Flag.withDescription("Stop after this many runs"),
      Flag.optional,
    ),
    expiresAt: Flag.String("expires-at").pipe(
      Flag.withDescription("Stop after this ISO-8601 instant"),
      Flag.optional,
    ),
    worktree: worktreeFlag(),
    worktreeBase: worktreeBaseFlag(),
    provider: providerFlag(),
    modelId: modelIdFlag(),
    runNow: Flag.Boolean("run-now").pipe(
      Flag.withDescription("Also run once immediately"),
      Flag.withDefault(false),
    ),
    disabled: Flag.Boolean("disabled").pipe(
      Flag.withDescription("Create it disabled"),
      Flag.withDefault(false),
    ),
    ...outputFlags,
  },
  (input) =>
    onClient(input, async (client) => {
      const spec = specFrom(input);
      if (spec === undefined) throw new Error("pass one of --cron, --every, --at, --manual");
      const model = pairedModel(input.provider, input.modelId);
      const worktree = worktreeInput(input.worktree, input.worktreeBase);
      const session = sessionPolicyFrom(input.sessionPolicy, input.sessionId);
      const projectId = await resolveProjectId(client, input.projectId, input.cwd);
      printSchedule(
        await client.schedule.create({
          name: input.name,
          projectId,
          prompt: input.prompt,
          spec,
          ...(input.disabled ? { enabled: false } : undefined),
          ...(session !== undefined ? { session } : undefined),
          ...(Option.isSome(input.expiresAt) ? { expiresAt: input.expiresAt.value } : undefined),
          ...(Option.isSome(input.maxRuns) ? { maxRuns: input.maxRuns.value } : undefined),
          ...(input.runNow ? { runNow: true } : undefined),
          ...(worktree !== undefined ? { worktree } : undefined),
          ...model,
        }),
        input,
      );
    }),
).pipe(Command.withDescription("Create a schedule"));

const scheduleUpdate = Command.make(
  "update",
  {
    id: scheduleIdArg(),
    name: Flag.String("name").pipe(Flag.withDescription("New name"), Flag.optional),
    prompt: Flag.String("prompt").pipe(Flag.withDescription("New prompt"), Flag.optional),
    ...specFlags,
    ...policyFlags,
    enable: Flag.Boolean("enable").pipe(Flag.withDefault(false)),
    disable: Flag.Boolean("disable").pipe(Flag.withDefault(false)),
    maxRuns: Flag.Int("max-runs").pipe(
      Flag.withDescription("Stop after this many runs"),
      Flag.optional,
    ),
    expiresAt: Flag.String("expires-at").pipe(
      Flag.withDescription("Stop after this ISO-8601 instant"),
      Flag.optional,
    ),
    provider: providerFlag(),
    modelId: modelIdFlag(),
    ...outputFlags,
  },
  (input) =>
    onClient(input, async (client) => {
      if (input.enable && input.disable) throw new Error("pass only one of --enable or --disable");
      const spec = specFrom(input);
      const model = pairedModel(input.provider, input.modelId);
      const session = sessionPolicyFrom(input.sessionPolicy, input.sessionId);
      printSchedule(
        await client.schedule.update({
          id: input.id,
          ...(Option.isSome(input.name) ? { name: input.name.value } : undefined),
          ...(Option.isSome(input.prompt) ? { prompt: input.prompt.value } : undefined),
          ...(spec !== undefined ? { spec } : undefined),
          ...(input.enable || input.disable ? { enabled: input.enable } : undefined),
          ...(session !== undefined ? { session } : undefined),
          ...(Option.isSome(input.expiresAt) ? { expiresAt: input.expiresAt.value } : undefined),
          ...(Option.isSome(input.maxRuns) ? { maxRuns: input.maxRuns.value } : undefined),
          ...model,
        }),
        input,
      );
    }),
).pipe(Command.withDescription("Change a schedule; --disable/--enable stops or resumes it"));

const scheduleRm = Command.make("rm", { id: scheduleIdArg(), ...outputFlags }, (input) =>
  onClient(input, async (client) => {
    await client.schedule.rm({ id: input.id });
    if (input.json) printJson({ id: input.id, ok: true });
    else writeStdout(input.id);
  }),
).pipe(Command.withDescription("Delete a schedule"));

const scheduleRun = Command.make("run", { id: scheduleIdArg(), ...outputFlags }, (input) =>
  onClient(input, async (client) => {
    const result = await client.schedule.run({ id: input.id });
    if (input.json) printJson(result);
    else if (result.ref !== undefined) printRef(result.ref, input);
    else writeStdout(`${input.id}\tskipped`);
  }),
).pipe(Command.withDescription("Run a schedule now; prints the session it started"));

export const scheduleCommand = Command.make("schedule", {}, () =>
  Effect.fail(new Error("usage: pie schedule list|get|create|update|rm|run")),
).pipe(
  Command.withDescription("Manage schedules"),
  Command.withSubcommands([
    scheduleList,
    scheduleGet,
    scheduleCreate,
    scheduleUpdate,
    scheduleRm,
    scheduleRun,
  ]),
);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const projectLs = Command.make("ls", { ...outputFlags }, (input) =>
  onClient(input, async (client) => {
    const projects = await client.project.ls();
    if (input.json) {
      printJson(projects);
      return;
    }
    for (const project of projects) {
      writeStdout(input.quiet ? project.id : `${project.id}\t${project.path}`);
    }
  }),
).pipe(Command.withDescription("List projects"));

const projectCreate = Command.make(
  "create",
  {
    path: Argument.String("path").pipe(Argument.withDescription("Directory to register")),
    ...outputFlags,
  },
  (input) =>
    onClient(input, async (client) => {
      const project = await client.project.create({ path: path.resolve(input.path) });
      if (input.json) printJson(project);
      else writeStdout(input.quiet ? project.id : `${project.id}\t${project.path}`);
    }),
).pipe(
  Command.withDescription("Register a directory as a project, or print the one already there"),
);

export const projectCommand = Command.make("project", {}, () =>
  Effect.fail(new Error("usage: pie project ls|create")),
).pipe(
  Command.withDescription("Manage projects"),
  Command.withSubcommands([projectLs, projectCreate]),
);

// ---------------------------------------------------------------------------
// MCP: print how an external client connects. It gets its own credential.
// ---------------------------------------------------------------------------

export const mcpCommand = Command.make("mcp", { ...outputFlags }, (input) =>
  Effect.gen(function* () {
    const endpoint = yield* resolvePieEndpoint(input.url);
    const daemonToken =
      endpoint.token ??
      (yield* Effect.fail(
        new Error(
          "MCP needs the authenticated daemon; a server without PIE_AUTH_TOKEN has no credential to derive one from",
        ),
      ));
    const url = new URL(MCP_PATH, endpoint.address).href;
    const token = deriveMcpToken(daemonToken);
    if (input.json) printJson({ url, token });
    else writeStdout(`${url}\t${token}`);
  }),
).pipe(
  Command.withDescription(
    "Print the MCP endpoint URL and its bearer token (a secret; not the daemon token)",
  ),
);

const sessionCommand = Command.make("session", {}, () =>
  Effect.fail(new Error("usage: pie session rename|model|queue|archive|respond")),
).pipe(
  Command.withDescription("Less common session commands"),
  Command.withSubcommands([
    renameCommand,
    modelCommand,
    queueCommand,
    archiveCommand,
    respondCommand,
  ]),
);

/** Daily session verbs stay at the root. The rest live under `pie session`. */
export const sessionWorkCommands = [
  runCommand,
  sendCommand,
  lsCommand,
  logsCommand,
  waitCommand,
  interruptCommand,
  sessionCommand,
  prCommand,
  scheduleCommand,
  projectCommand,
  mcpCommand,
] as const;
