import type { PullRequestActionInput } from "@getpie/contract/pull-request";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@getpie/ui/components/alert-dialog";
import { Button } from "@getpie/ui/components/button";

import {
  actionConfirmationDescription,
  actionConfirmationTitle,
} from "./pull-request-presentation";

export function ConfirmPullRequestAction({
  input,
  loading,
  onCancel,
  onConfirm,
}: {
  input: PullRequestActionInput;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const description = actionConfirmationDescription(input);
  return (
    <AlertDialog open onOpenChange={(open) => !open && !loading && onCancel()}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{actionConfirmationTitle(input.action)}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button disabled={loading} onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button loading={loading} onClick={onConfirm}>
            Confirm
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
