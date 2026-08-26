import { Button } from "@getpie/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@getpie/ui/components/dialog";
import { Input } from "@getpie/ui/components/input";
import { Label } from "@getpie/ui/components/label";
import { use, useState, type FormEvent, type ReactElement } from "react";
import { toast } from "sonner";

import { usePlatform } from "@/platform-context";

export function AddSshHostDialog({ onClose }: { onClose: () => void }): ReactElement {
  const ssh = usePlatform().ssh;
  const [hostsPromise] = useState(() => ssh?.discoverHosts() ?? Promise.resolve([]));
  const hosts = use(hostsPromise);
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const trimmed = target.trim();

  if (!ssh || !ssh.client.available) return <></>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed.length === 0 || pending) return;
    setPending(true);
    void ssh
      .connect(trimmed)
      .then(() => {
        onClose();
      })
      .catch((error: unknown) => {
        setPending(false);
        toast.error(error instanceof Error ? error.message : "Failed to connect over SSH.");
      });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogPopup className="max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add SSH host</DialogTitle>
            <DialogDescription>
              Pie launches the remote pie daemon and forwards it to this computer over SSH. Use
              ssh-agent or an IdentityFile; password prompts are not wired yet.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-6 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ssh-target">Host</Label>
              <Input
                id="ssh-target"
                autoComplete="off"
                autoFocus
                disabled={pending}
                list="ssh-discovered-hosts"
                placeholder="user@example.com"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
              <datalist id="ssh-discovered-hosts">
                {hosts.map((host) => (
                  <option key={`${host.source}:${host.alias}`} value={host.alias}>
                    {host.alias}
                  </option>
                ))}
              </datalist>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={pending} type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={pending || trimmed.length === 0} type="submit">
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
