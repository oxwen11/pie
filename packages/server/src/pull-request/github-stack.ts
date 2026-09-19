import {
  pullRequestKey,
  type PullRequestMergeMethod,
  type PullRequestRef,
  type PullRequestStack,
  type PullRequestStackAction,
  type PullRequestStackActionResult,
  type PullRequestStackExpected,
  type PullRequestStackPreview,
} from "@getpie/contract/pull-request";
import { Effect, Schema } from "effect";

import {
  PullRequestActionOutcomeUnknown,
  PullRequestHostRejected,
  PullRequestInvalidResponse,
  PullRequestStaleContext,
  PullRequestUnsupportedAction,
} from "./errors";
import type { PullRequestCliActionFailure, PullRequestReadFailure } from "./github-cli";

const RawStack = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Union([Schema.Int, Schema.String]))),
  node_id: Schema.optional(Schema.NullOr(Schema.String)),
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  base: Schema.Union([Schema.String, Schema.Struct({ ref: Schema.String })]),
  pull_requests: Schema.Array(
    Schema.Struct({
      number: Schema.Int.check(Schema.isGreaterThan(0)),
      head: Schema.Struct({ ref: Schema.String, sha: Schema.optional(Schema.String) }),
      state: Schema.optional(Schema.NullOr(Schema.Literals(["open", "closed"]))),
      draft: Schema.optional(Schema.Boolean),
      merged_at: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ).check(Schema.isMaxLength(100)),
});

const Branch = Schema.Struct({
  id: Schema.String,
  headRefOid: Schema.String,
  baseRef: Schema.NullOr(
    Schema.Struct({ compare: Schema.NullOr(Schema.Struct({ behindBy: Schema.Int })) }),
  ),
  headRepository: Schema.NullOr(Schema.Struct({ viewerPermission: Schema.NullOr(Schema.String) })),
  maintainerCanModify: Schema.Boolean,
});
// The aliased member selection is bounded by the already validated native topology.
const AccessJson = Schema.Struct({
  data: Schema.Struct({
    __type: Schema.NullOr(
      Schema.Struct({ inputFields: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    ),
    repository: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  }),
});

const MERGE_METHODS = [
  "merge",
  "squash",
  "rebase",
] as const satisfies readonly PullRequestMergeMethod[];
const AsyncMergeAccepted = Schema.Struct({
  uuid: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  details: Schema.optional(
    Schema.Struct({
      sha: Schema.optional(Schema.String),
      uuid: Schema.optional(Schema.String),
    }),
  ),
});
const AsyncMergeResult = Schema.Struct({
  status: Schema.optional(Schema.String),
  details: Schema.optional(
    Schema.Struct({
      message: Schema.optional(Schema.String),
      sha: Schema.optional(Schema.String),
    }),
  ),
});
const Updated = Schema.Struct({
  data: Schema.Struct({
    updatePullRequestBranch: Schema.Struct({
      pullRequest: Schema.Struct({ headRefOid: Schema.String }),
    }),
  }),
});

type Read = (
  args: ReadonlyArray<string>,
  missing?: boolean,
) => Effect.Effect<unknown, PullRequestReadFailure>;
type Write = (args: ReadonlyArray<string>) => Effect.Effect<unknown, PullRequestCliActionFailure>;

const parse = <A>(decode: () => A): Effect.Effect<A, PullRequestInvalidResponse> =>
  Effect.try({ try: decode, catch: () => new PullRequestInvalidResponse() });
const repoPath = (ref: PullRequestRef) => `repos/${ref.owner}/${ref.repository}`;
const api = (ref: PullRequestRef, args: ReadonlyArray<string>) => [
  "api",
  "--hostname",
  ref.host,
  ...args,
];
const canWrite = (permission: unknown) =>
  permission === "ADMIN" || permission === "MAINTAIN" || permission === "WRITE";

export const makeGitHubStack = (read: Read, write: Write) => {
  const native = (ref: PullRequestRef) =>
    Effect.gen(function* () {
      const value = yield* read(
        api(ref, [`${repoPath(ref)}/stacks?pull_request=${ref.number}`]),
        true,
      );
      if (value === null) return null;
      return yield* parse(() => {
        const stacks = Schema.decodeUnknownSync(
          Schema.Array(RawStack).check(Schema.isMaxLength(1)),
        )(value);
        const raw = stacks[0];
        if (!raw) return null;
        if (
          raw.pull_requests.length === 0 ||
          new Set(raw.pull_requests.map((member) => member.number)).size !==
            raw.pull_requests.length ||
          !raw.pull_requests.some((member) => member.number === ref.number)
        )
          throw new Error("Invalid native membership");
        const stack: PullRequestStack = {
          id: String(raw.id ?? raw.node_id ?? raw.number),
          number: raw.number,
          baseBranch: typeof raw.base === "string" ? raw.base : raw.base.ref,
          layers: raw.pull_requests.map((member) => ({
            ref: { ...ref, number: member.number },
            headBranch: member.head.ref,
            lifecycle: member.merged_at
              ? { type: "merged" }
              : member.state === "closed" && member.merged_at === null
                ? { type: "closed" }
                : member.state === "open" && member.draft !== undefined
                  ? { type: "open", draft: member.draft }
                  : null,
          })),
        };
        const expected: PullRequestStackExpected = {
          stackId: stack.id,
          baseBranch: stack.baseBranch,
          members: raw.pull_requests.map((member) => ({
            pullRequest: { ...ref, number: member.number },
            headBranch: member.head.ref,
            headSha: member.head.sha ?? "",
          })),
        };
        return { stack, expected };
      });
    });

  const access = (ref: PullRequestRef, stack: PullRequestStack) =>
    Effect.gen(function* () {
      const query = `query($owner:String!,$name:String!){__type(name:"UpdatePullRequestBranchInput"){inputFields{name}} repository(owner:$owner,name:$name){viewerPermission ${stack.layers.map((member) => `pr${member.ref.number}:pullRequest(number:${member.ref.number}){id headRefOid baseRef{compare(headRef:${JSON.stringify(member.headBranch)}){behindBy}} headRepository{viewerPermission} maintainerCanModify}`).join(" ")}}}`;
      const value = yield* read(
        api(ref, [
          "graphql",
          "-f",
          `owner=${ref.owner}`,
          "-f",
          `name=${ref.repository}`,
          "-f",
          `query=${query}`,
        ]),
      );
      return yield* parse(() => {
        const raw = Schema.decodeUnknownSync(AccessJson)(value).data;
        const fields = raw["__type"]?.inputFields.map((field) => field.name) ?? [];
        const branches = stack.layers.map((member) =>
          Schema.decodeUnknownSync(Branch)(raw.repository?.[`pr${member.ref.number}`]),
        );
        return {
          branches,
          supported: fields.includes("expectedHeadOid") && fields.includes("updateMethod"),
          permitted: branches.every(
            (branch, index) =>
              stack.layers[index]?.lifecycle?.type === "merged" ||
              canWrite(branch.headRepository?.viewerPermission) ||
              (branch.headRepository !== null &&
                branch.maintainerCanModify &&
                canWrite(raw.repository?.viewerPermission)),
          ),
        };
      });
    });

  const preview = (
    ref: PullRequestRef,
    action: PullRequestStackAction,
  ): Effect.Effect<
    PullRequestStackPreview,
    PullRequestReadFailure | PullRequestUnsupportedAction
  > =>
    Effect.gen(function* () {
      const data = yield* native(ref);
      if (data === null) return yield* new PullRequestUnsupportedAction();
      const index = data.stack.layers.findIndex(
        (layer) => pullRequestKey(layer.ref) === pullRequestKey(ref),
      );
      const affected = (
        action === "merge" ? data.stack.layers.slice(0, index + 1) : data.stack.layers
      ).filter((layer) => layer.lifecycle?.type !== "merged");
      let reason: string | undefined;
      let methods: PullRequestMergeMethod[] = [];
      if (action === "rebase" && index !== data.stack.layers.length - 1)
        reason = "Select the top layer to rebase the Stack.";
      else if (affected.length === 0 || affected.some((layer) => layer.lifecycle?.type !== "open"))
        reason = "Every affected layer must be open.";
      else if (data.expected.members.some((member) => !member.headSha))
        reason = "GitHub did not return every member's head commit.";
      else {
        const permissions = yield* access(ref, data.stack);
        if (action === "rebase" && !permissions.supported)
          reason = "This host cannot safely rebase branches with expected heads.";
        else if (!permissions.permitted) reason = "You cannot update every affected branch.";
        else if (
          permissions.branches.some(
            (branch, member) => branch.headRefOid !== data.expected.members[member]?.headSha,
          )
        )
          reason = "The Stack changed. Refresh before confirming.";
        else if (action === "merge") methods = [...MERGE_METHODS];
      }
      return {
        pullRequest: ref,
        action,
        ...data,
        affected: affected.map((layer) => layer.ref),
        methods,
        allowed: reason === undefined,
        ...(reason ? { reason } : undefined),
      };
    });

  const matches = (left: PullRequestStackExpected, right: PullRequestStackExpected) =>
    left.stackId === right.stackId &&
    left.baseBranch === right.baseBranch &&
    left.members.length === right.members.length &&
    left.members.every((member, index) => {
      const other = right.members[index];
      return (
        other !== undefined &&
        pullRequestKey(member.pullRequest) === pullRequestKey(other.pullRequest) &&
        member.headBranch === other.headBranch &&
        member.headSha === other.headSha &&
        member.headSha.length > 0
      );
    });

  const merge = (
    ref: PullRequestRef,
    expected: PullRequestStackExpected,
    method: PullRequestMergeMethod,
    fresh: PullRequestStackPreview,
  ) =>
    Effect.gen(function* () {
      const sha = expected.members.find(
        (member) => pullRequestKey(member.pullRequest) === pullRequestKey(ref),
      )?.headSha;
      if (!sha || !fresh.methods.includes(method)) return yield* new PullRequestUnsupportedAction();
      let submitted = false;
      const step = yield* Effect.result(
        Effect.gen(function* () {
          submitted = true;
          const acceptedRaw = yield* write(
            api(ref, [
              "--method",
              "PUT",
              `${repoPath(ref)}/pulls/${ref.number}/merge-async`,
              "-f",
              `sha=${sha}`,
              "-f",
              `merge_method=${method}`,
            ]),
          );
          const accepted = yield* parse(() =>
            Schema.decodeUnknownSync(AsyncMergeAccepted)(acceptedRaw),
          );
          if (accepted.status === "merged" || accepted.details?.sha) return;
          const uuid = accepted.uuid ?? accepted.details?.uuid;
          if (!uuid) return yield* new PullRequestInvalidResponse();
          for (let attempt = 0; attempt < 30; attempt++) {
            const polledRaw = yield* read(
              api(ref, [`${repoPath(ref)}/pulls/${ref.number}/merge-async/${uuid}`]),
            );
            const polled = yield* parse(() =>
              Schema.decodeUnknownSync(AsyncMergeResult)(polledRaw),
            );
            if (polled.status === "merged" || polled.details?.sha) return;
            if (polled.status === "failed" || polled.status === "error")
              return yield* new PullRequestHostRejected();
            yield* Effect.sleep("1 second");
          }
          return yield* new PullRequestActionOutcomeUnknown();
        }),
      );
      if (step._tag === "Failure") {
        if (!submitted) return yield* step.failure;
        if (step.failure._tag === "PullRequestHostRejected") return yield* step.failure;
        return {
          action: "merge" as const,
          completed: [],
          outcome: "unknown" as const,
          message: "The stack merge result is unknown. Check GitHub before retrying.",
        };
      }
      return { action: "merge" as const, completed: fresh.affected, outcome: "applied" as const };
    });

  const run = (
    ref: PullRequestRef,
    action: PullRequestStackAction,
    expected: PullRequestStackExpected,
    method?: PullRequestMergeMethod,
  ): Effect.Effect<
    PullRequestStackActionResult,
    PullRequestReadFailure | PullRequestCliActionFailure
  > =>
    Effect.gen(function* () {
      const fresh = yield* preview(ref, action);
      if (!matches(fresh.expected, expected)) return yield* new PullRequestStaleContext();
      if (!fresh.allowed) return yield* new PullRequestUnsupportedAction();
      if (action === "merge") {
        if (!method) return yield* new PullRequestUnsupportedAction();
        return yield* merge(ref, expected, method, fresh);
      }
      const completed: PullRequestRef[] = [];
      const observed = { ...expected };
      for (const target of fresh.affected) {
        let submitted = false;
        const step = yield* Effect.result(
          Effect.gen(function* () {
            const latest = yield* native(ref);
            if (
              latest === null ||
              !matches(latest.expected, observed) ||
              latest.stack.baseBranch !== fresh.stack.baseBranch ||
              latest.stack.layers.some(
                (layer, index) =>
                  layer.headBranch !== fresh.stack.layers[index]?.headBranch ||
                  layer.lifecycle?.type !== fresh.stack.layers[index]?.lifecycle?.type,
              )
            )
              return yield* new PullRequestStaleContext();
            const permissions = yield* access(ref, latest.stack);
            if (!permissions.supported || !permissions.permitted)
              return yield* new PullRequestUnsupportedAction();
            if (
              permissions.branches.some(
                (branch, index) => branch.headRefOid !== observed.members[index]?.headSha,
              )
            )
              return yield* new PullRequestStaleContext();
            const index = latest.stack.layers.findIndex(
              (layer) => pullRequestKey(layer.ref) === pullRequestKey(target),
            );
            const branch = permissions.branches[index];
            if (!branch?.baseRef?.compare) return yield* new PullRequestUnsupportedAction();
            if (branch.baseRef.compare.behindBy === 0) return;
            submitted = true;
            const response = yield* write(
              api(ref, [
                "graphql",
                "-f",
                `id=${branch.id}`,
                "-f",
                `sha=${branch.headRefOid}`,
                "-f",
                "query=mutation($id:ID!,$sha:GitObjectID!){updatePullRequestBranch(input:{pullRequestId:$id,expectedHeadOid:$sha,updateMethod:REBASE}){pullRequest{headRefOid}}}",
              ]),
            );
            const head = yield* parse(
              () =>
                Schema.decodeUnknownSync(Updated)(response).data.updatePullRequestBranch.pullRequest
                  .headRefOid,
            );
            if (!head) return yield* new PullRequestInvalidResponse();
            observed.members = observed.members.map((member, memberIndex) =>
              memberIndex === index ? { ...member, headSha: head } : member,
            );
          }),
        );
        if (step._tag === "Failure") {
          const uncertain =
            submitted &&
            (step.failure._tag === "PullRequestActionOutcomeUnknown" ||
              step.failure._tag === "PullRequestInvalidResponse");
          if (completed.length === 0 && !uncertain) return yield* step.failure;
          return {
            action,
            completed,
            outcome: uncertain ? "unknown" : "partial",
            message: uncertain
              ? `The result for PR #${target.number} is unknown. Check GitHub before retrying.`
              : `Stopped at PR #${target.number}. Earlier updates remain on GitHub. Refresh before retrying.`,
          };
        }
        completed.push(target);
      }
      return { action, completed, outcome: "applied" };
    });
  return {
    stack: (ref: PullRequestRef) => native(ref).pipe(Effect.map((value) => value?.stack ?? null)),
    preview,
    run,
  };
};
