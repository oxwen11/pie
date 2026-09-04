import type { SessionSummary } from "@getpie/contract";
import { MAX_SESSION_TITLE_CHARS } from "@getpie/contract/domain";
import { Button } from "@getpie/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@getpie/ui/components/dialog";
import { Input } from "@getpie/ui/components/input";
import { Label } from "@getpie/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Give a session a title of your own. Mount only while open — the draft title
 * resets by unmounting on close, the same way the import dialog resets its
 * browsing state.
 *
 * The server publishes `session.renamed` only after the title is durable. Both
 * the global subscriber and this initiating mutation invalidate the lists, so
 * `session.list` remains the single source of truth.
 */
export function RenameSessionDialog({
  session,
  onClose,
}: {
  readonly session: SessionSummary;
  onClose: () => void;
}) {
  const { orpcQueryUtils } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(session.title ?? "");
  // The wire schema takes a trimmed, non-empty title; trimming here makes
  // " foo " a rename rather than a validation error the user must decode.
  const title = draft.trim();

  const rename = useMutation({
    mutationFn: (nextTitle: string) =>
      orpcQueryUtils.agent.session.rename.call({
        ref: {
          projectId: session.projectId,
          sessionId: session.sessionId,
        },
        title: nextTitle,
      }),
    onSuccess: (_result, nextTitle) => {
      for (const archived of [false, true]) {
        const queryKey = orpcQueryUtils.agent.session.list.queryOptions({
          input: { projectId: session.projectId, archived },
        }).queryKey;
        queryClient.setQueryData<ReadonlyArray<SessionSummary>>(queryKey, (previous) =>
          previous?.map((row) =>
            row.sessionId === session.sessionId ? { ...row, title: nextTitle } : row,
          ),
        );
        void queryClient.invalidateQueries({ queryKey });
      }
      onClose();
    },
    onError: (error) => toast.error(`Failed to rename session: ${error.message}`),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !rename.isPending && onClose()}>
      <DialogPopup className="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            rename.mutate(title);
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>
              The title is yours — a later prompt never overwrites it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-start gap-2 px-6 pb-4">
            <Label htmlFor="session-title">Title</Label>
            <Input
              autoFocus
              disabled={rename.isPending}
              id="session-title"
              maxLength={MAX_SESSION_TITLE_CHARS}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder="New chat"
              value={draft}
            />
          </div>
          <DialogFooter>
            <DialogClose
              render={<Button disabled={rename.isPending} type="button" variant="outline" />}
            >
              Cancel
            </DialogClose>
            <Button
              disabled={rename.isPending || title === "" || title === session.title}
              type="submit"
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
