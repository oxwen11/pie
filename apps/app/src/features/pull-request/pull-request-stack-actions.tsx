import type { SessionRef } from "@getpie/contract";
import {
  pullRequestKey,
  type PullRequestRef,
  type PullRequestStackAction,
  type PullRequestStackPreview,
  type PullRequestMergeMethod,
} from "@getpie/contract/pull-request";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@getpie/ui/components/alert-dialog";
import { Button } from "@getpie/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";

export function PullRequestStackActions({
  sessionRef,
  pullRequest,
}: {
  sessionRef: SessionRef;
  pullRequest: PullRequestRef;
}) {
  const { orpcClient, orpcQueryUtils, queryClient } = useRouteContext({ from: "__root__" });
  const preview = useMutation({
    mutationFn: (action: PullRequestStackAction) =>
      orpcClient.pullRequest.stackPreview({ ref: sessionRef, pullRequest, action }),
    retry: false,
  });
  const action = useMutation({
    mutationFn: ({
      preview: approved,
      method,
    }: {
      preview: PullRequestStackPreview;
      method?: PullRequestMergeMethod;
    }) =>
      orpcClient.pullRequest.runStackAction({
        ref: sessionRef,
        pullRequest: approved.pullRequest,
        action: approved.action,
        expected: approved.expected,
        ...(method ? { method } : undefined),
      }),
    retry: false,
    // Even a lost response can follow a write: consume the preview and refresh.
    onSettled: () => {
      preview.reset();
      void queryClient.invalidateQueries({ queryKey: orpcQueryUtils.pullRequest.statuses.key() });
      void queryClient.invalidateQueries({ queryKey: orpcQueryUtils.pullRequest.detail.key() });
    },
  });
  const completed = action.data?.completed.map(pullRequestKey).join(", ");
  return (
    <section className="flex flex-col gap-2 border-t pt-3" aria-label="Native Stack actions">
      <h3 className="text-sm font-medium">Native Stack actions</h3>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={preview.isPending || action.isPending}
          onClick={() => preview.mutate("merge")}
        >
          Preview merge Stack
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={preview.isPending || action.isPending}
          onClick={() => preview.mutate("rebase")}
        >
          Preview rebase Stack
        </Button>
      </div>
      {preview.isError ? (
        <p role="alert" className="text-destructive text-xs">
          Preview failed: {preview.error.message}. Try preview again.
        </p>
      ) : null}
      {action.isError ? (
        <p role="alert" className="text-destructive text-xs">
          {action.error.message} Check GitHub before trying again; a new preview is required.
        </p>
      ) : null}
      {action.data ? (
        <div role="status" className="text-sm">
          <p>
            {action.data.outcome === "applied"
              ? "Stack action applied."
              : action.data.outcome === "partial"
                ? "Stack action partially completed."
                : "Stack action outcome is unknown. Check GitHub before trying again."}
          </p>
          <p>
            {completed ? `Confirmed completed: ${completed}` : "No completed layers confirmed."}
          </p>
          {action.data.message ? <p>{action.data.message}</p> : null}
        </div>
      ) : null}
      {preview.data ? (
        <ConfirmStackAction
          preview={preview.data}
          loading={action.isPending}
          onCancel={() => preview.reset()}
          onConfirm={(method) => action.mutate({ preview: preview.data!, method })}
        />
      ) : null}
    </section>
  );
}

function ConfirmStackAction({
  preview,
  loading,
  onCancel,
  onConfirm,
}: {
  preview: PullRequestStackPreview;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (method?: PullRequestMergeMethod) => void;
}) {
  const [method, setMethod] = useState<PullRequestMergeMethod | undefined>(preview.methods[0]);
  const canConfirm =
    preview.allowed &&
    (preview.action !== "merge" || (method !== undefined && preview.methods.includes(method)));
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !loading) onCancel();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {preview.action === "merge" ? "Merge" : "Rebase"} native Stack #{preview.stack.number}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {preview.action === "merge"
              ? "Merge the selected layer and affected lower layers using the selected strategy."
              : "Rebase rewrites remote branch history from bottom to top. Partial completion is possible; this does not change the local checkout."}{" "}
            All members and heads will be checked again before the action.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ol className="my-3 list-inside list-decimal text-sm" aria-label="Affected layers">
          {preview.affected.map((ref) => (
            <li key={pullRequestKey(ref)}>{pullRequestKey(ref)}</li>
          ))}
        </ol>
        {preview.action === "merge" ? (
          <fieldset className="my-3 flex gap-3">
            <legend className="text-sm">Merge strategy</legend>
            {preview.methods.map((option) => (
              <label key={option} className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="stack-merge-method"
                  checked={method === option}
                  onChange={() => setMethod(option)}
                />
                {option}
              </label>
            ))}
          </fieldset>
        ) : null}
        {!preview.allowed ? (
          <p role="alert" className="text-muted-foreground text-sm">
            {preview.reason ?? "This host cannot perform this Stack action safely."}
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button variant="outline" disabled={loading} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!canConfirm} loading={loading} onClick={() => onConfirm(method)}>
            Confirm {preview.action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
