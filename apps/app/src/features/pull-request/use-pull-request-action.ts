import type { PullRequestActionInput } from "@getpie/contract/pull-request";
import { ORPCError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { pullRequestActionError } from "./pull-request-action-error";

export interface PullRequestActionState {
  readonly intent: PullRequestActionInput | null;
  readonly pending: boolean;
  readonly postActionRefreshFailed: boolean;
  readonly refresh: () => void;
  readonly run: (input: PullRequestActionInput) => void;
  readonly setIntent: (intent: PullRequestActionInput | null) => void;
}

export interface UsePullRequestActionOptions {
  readonly mutationFn: (input: PullRequestActionInput) => Promise<unknown>;
  readonly mutationKey: ReadonlyArray<unknown>;
  readonly onApplied?: () => void;
  readonly refetchDetail: () => Promise<{ readonly isError: boolean }>;
  readonly refetchDiff: () => Promise<unknown>;
}

export function usePullRequestAction({
  mutationFn,
  mutationKey,
  onApplied,
  refetchDetail,
  refetchDiff,
}: UsePullRequestActionOptions): PullRequestActionState {
  const [intent, setIntent] = useState<PullRequestActionInput | null>(null);
  const [postActionRefreshFailed, setPostActionRefreshFailed] = useState(false);
  const refresh = (): void => {
    void refetchDetail().then((result) => {
      if (!result.isError) setPostActionRefreshFailed(false);
      return undefined;
    });
    void refetchDiff();
  };
  const action = useMutation({
    mutationFn,
    mutationKey,
    onError: (error) => {
      toast.error(pullRequestActionError(error));
      if (error instanceof ORPCError && error.code === "STALE_CONTEXT") refresh();
    },
    onMutate: () => setPostActionRefreshFailed(false),
    onSuccess: () => {
      setIntent(null);
      toast.success("Pull request action applied");
      onApplied?.();
      void refetchDetail().then(
        (result) => setPostActionRefreshFailed(result.isError),
        () => setPostActionRefreshFailed(true),
      );
      void refetchDiff();
    },
  });

  return {
    intent,
    pending: action.isPending,
    postActionRefreshFailed,
    refresh,
    run: (input) => action.mutate(input),
    setIntent,
  };
}
