import path from "node:path";

import type { PieClient } from "@getpie/client";
import type {
  CreateWorktreeInput,
  PromptPart,
  SessionRef,
  SubscribeStreamEvent,
} from "@getpie/contract";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import {
  type PieEndpoint,
  createPieClientFromEndpoint,
  describeConnectFailure,
  resolvePieEndpoint,
  urlFlag,
} from "./connect";

const projectIdFlag = () =>
  Flag.string("project-id").pipe(
    Flag.withDescription(
      "Registered project id (default: look up or create the project for --cwd / cwd)",
    ),
    Flag.optional,
  );

const cwdFlag = () =>
  Flag.string("cwd").pipe(
    Flag.withDescription("Project directory used when --project-id is omitted (default: cwd)"),
    Flag.optional,
  );

const sessionIdFlag = () =>
  Flag.string("session-id").pipe(Flag.withDescription("Reuse an existing session"), Flag.optional);

const providerFlag = () =>
  Flag.string("provider").pipe(Flag.withDescription("Model provider"), Flag.optional);

const modelIdFlag = () =>
  Flag.string("model-id").pipe(
    Flag.withDescription("Model id (must be passed with --provider)"),
    Flag.optional,
  );

const worktreeFlag = () =>
  Flag.boolean("worktree").pipe(
    Flag.withDescription("Create a git worktree for this session (branch name is server-assigned)"),
    Flag.withDefault(false),
  );

const worktreeBaseFlag = () =>
  Flag.string("worktree-base").pipe(
    Flag.withDescription("Ref to branch the worktree from (implies --worktree; default HEAD)"),
    Flag.optional,
  );

const failFrom = (cause: unknown): Error =>
  new Error(cause instanceof Error ? cause.message : String(cause));

const run = (action: () => Promise<void>) => Effect.tryPromise({ try: action, catch: failFrom });

const textFromParts = (parts: ReadonlyArray<PromptPart>): string =>
  parts
    .filter((part): part is Extract<PromptPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");

/** Print live user/assistant text from the session stream until the turn ends. */
export async function printTurn(
  stream: AsyncIterable<SubscribeStreamEvent>,
  write: (text: string) => void = (text) => {
    process.stdout.write(text);
  },
): Promise<void> {
  let assistantOpen = false;
  for await (const item of stream) {
    if (item.type !== "event") continue;
    const event = item.event;
    if (event.type === "session.prompt.submitted") {
      write(`user: ${textFromParts(event.parts)}\n`);
    } else if (event.type === "session.message.chunk" && event.chunk.type === "text-delta") {
      if (!assistantOpen) {
        write("assistant: ");
        assistantOpen = true;
      }
      write(event.chunk.delta);
    } else if (event.type === "session.turn.ended") {
      if (assistantOpen) write("\n");
      return;
    }
  }
}

async function resolveProjectId(
  client: PieClient,
  projectId: Option.Option<string>,
  cwd: Option.Option<string>,
): Promise<string> {
  if (Option.isSome(projectId)) return projectId.value;
  const workspace = path.resolve(Option.getOrElse(cwd, () => process.cwd()));
  // `project.create` reuses a row that already points at this path.
  const project = await client.project.create({ path: workspace });
  return project.id;
}

async function resolveSessionRef(
  client: PieClient,
  sessionId: string,
  projectId: Option.Option<string>,
): Promise<SessionRef> {
  if (Option.isSome(projectId)) return { projectId: projectId.value, sessionId };
  return client.agent.session.resolveRef({ sessionId });
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

const promptTurn = async (client: PieClient, ref: SessionRef, text: string): Promise<void> => {
  const stream = await client.agent.session.subscribe({
    scope: { kind: "session", ref },
  });
  await client.agent.session.prompt({
    ref,
    parts: [{ type: "text", text }],
  });
  await printTurn(stream);
};

export const runCommand = Command.make(
  "run",
  {
    text: Argument.string("text").pipe(Argument.withDescription("Prompt text")),
    projectId: projectIdFlag(),
    cwd: cwdFlag(),
    sessionId: sessionIdFlag(),
    provider: providerFlag(),
    modelId: modelIdFlag(),
    worktree: worktreeFlag(),
    worktreeBase: worktreeBaseFlag(),
    url: urlFlag(),
  },
  (input) =>
    Effect.gen(function* () {
      const endpoint = yield* resolvePieEndpoint(input.url);
      yield* run(async () => {
        await withClient(endpoint, async (client) => {
          const model = pairedModel(input.provider, input.modelId);
          const worktree = worktreeInput(input.worktree, input.worktreeBase);
          let ref: SessionRef;
          if (Option.isSome(input.sessionId)) {
            if (worktree !== undefined) {
              throw new Error("--worktree only applies when creating a session");
            }
            ref = await resolveSessionRef(client, input.sessionId.value, input.projectId);
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
            console.log(`created session ${ref.sessionId} project ${ref.projectId}`);
            if (created.workspace.worktree !== undefined) {
              console.log(
                `worktree ${created.workspace.cwd} branch ${created.workspace.worktree.branch}`,
              );
            }
          }
          await promptTurn(client, ref, input.text);
        });
      });
    }),
).pipe(
  Command.withDescription(
    "Create a session (or reuse --session-id), send a prompt, and print the live turn",
  ),
);
