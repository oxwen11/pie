import { Button } from "@getpie/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@getpie/ui/components/dialog";

export type AutomationDeleteDialogProps = {
  readonly name: string;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

export function AutomationDeleteDialog({
  name,
  pending,
  onCancel,
  onConfirm,
}: AutomationDeleteDialogProps) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
      open
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete schedule</DialogTitle>
          <DialogDescription>
            {name} will stop creating sessions. Sessions it already created stay in the sidebar.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={pending} onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm} variant="destructive">
            Delete
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
