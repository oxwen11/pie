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
import { Suspense, use, useState, type FormEvent, type ReactElement } from "react";
import { toast } from "sonner";

import type { DiscoveredSshHost, PlatformSsh } from "@/platform";
import { usePlatform } from "@/platform-context";

function discoveredHostOptionLabel(host: DiscoveredSshHost): string {
  switch (host.source) {
    case "tailscale":
      return `${host.alias} (Tailscale)`;
    case "ssh-config":
    case "known-hosts":
      return host.alias;
    default: {
      const exhaustive: never = host.source;
      return exhaustive;
    }
  }
}

function loadDiscoveredHosts(ssh: PlatformSsh): Promise<readonly DiscoveredSshHost[]> {
  return ssh.discoverHosts().catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : "Failed to list SSH hosts.");
    return [];
  });
}

function DiscoveredSshHostOptions({ ssh }: { ssh: PlatformSsh }): ReactElement {
  const [hostsPromise] = useState(() => loadDiscoveredHosts(ssh));
  const hosts = use(hostsPromise);
  return (
    <>
      {hosts.map((host) => (
        <option key={`${host.source}:${host.alias}`} value={host.alias}>
          {discoveredHostOptionLabel(host)}
        </option>
      ))}
    </>
  );
}

export function AddSshHostDialog({ onClose }: { onClose: () => void }): ReactElement {
  const ssh = usePlatform().ssh;
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
              ssh-agent or an IdentityFile; password prompts are not wired yet. Tailscale MagicDNS
              names from your tailnet appear in the list when the Tailscale CLI is on PATH.
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
                placeholder="user@host or user@machine.tailnet.ts.net"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
              <datalist id="ssh-discovered-hosts">
                <Suspense fallback={null}>
                  <DiscoveredSshHostOptions ssh={ssh} />
                </Suspense>
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
