import path from "node:path";

import type { PieClient } from "@getpie/client";
import {
  AgentResponseSchema,
  type AgentRequest,
  type AgentResponse,
  type CreateWorktreeInput,
  type PieUIMessage,
  type SessionRef,
  type SubscribeStreamEvent,
} from "@getpie/contract";
import { Effect, Option, Runtime, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

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
      `session requires action; respond with: pie respond <session-id> --request ${requestId} …`,
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
  return client.agent.session.resolveRef({ sessionId });
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
  const snapshot = await client.agent.session.getSnapshot({ ref });
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
  const initial = await readWaitState(client, ref);
  if (initial !== "running") return initial;

  const stream = await client.agent.session.subscribe({
    scope: { kind: "session", ref },
  });
  const settled = await withTimeout(awaitTurn(stream), timeoutMs);
  if (settled.kind === "request") return settled;
  // turn.ended can race a late request; re-check snapshot once.
  return readWaitState(client, ref).then((state) => {
    if (state === "running") return { kind: "idle" };
    return state;
  });
}

async function promptAndOptionallyWait(
  client: PieClient,
  ref: SessionRef,
  text: string,
  noWait: boolean,
  timeoutMs: number,
): Promise<WaitState | undefined> {
  if (noWait) {
    await client.agent.session.prompt({
      ref,
      parts: [{ type: "text", text }],
    });
    return undefined;
  }
  const stream = await client.agent.session.subscribe({
    scope: { kind: "session", ref },
  });
  await client.agent.session.prompt({
    ref,
    parts: [{ type: "text", text }],
  });
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
              await client.agent.session.setModel({
                ref,
                provider: model.provider,
                modelId: model.modelId,
              });
            }
          } else {
            const projectId = await resolveProjectId(client, input.projectId, input.cwd);
            const created = await client.agent.session.create({
              projectId,
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

          const state = await promptAndOptionallyWait(
            client,
            ref,
            input.text,
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
          const { messages } = await client.agent.session.getMessages({ ref });
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
          if (!mode.json) printRef(ref, mode);
          const state = await promptAndOptionallyWait(
            client,
            ref,
            input.text,
            input.noWait,
            timeoutMs,
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
            const snapshot = await client.agent.session.getSnapshot({ ref });
            const request = snapshot.pendingRequests.find((item) => item.id === input.requestId);
            if (request === undefined) {
              throw new Error(`pending request not found: ${input.requestId}`);
            }
            response = buildAllowDenyResponse(request, input.allow ? "allow" : "deny");
          } else {
            throw new Error("pass --response <json>, or --allow / --deny");
          }
          await client.agent.session.respondToAgentRequest({
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
          await client.agent.session.interrupt({ ref });
          if (mode.json)
            printJson({ sessionId: ref.sessionId, projectId: ref.projectId, ok: true });
          else if (mode.quiet) writeStdout(ref.sessionId);
          else writeStdout(`${ref.sessionId}\t${ref.projectId}`);
        });
      });
    }),
).pipe(Command.withDescription("Interrupt the in-flight turn"));

export const sessionWorkCommands = [
  runCommand,
  waitCommand,
  logsCommand,
  sendCommand,
  respondCommand,
  interruptCommand,
] as const;
