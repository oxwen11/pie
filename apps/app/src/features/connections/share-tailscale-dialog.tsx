import { Button } from "@getpie/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@getpie/ui/components/dialog";
import { Suspense, use, useState, type ReactElement } from "react";
import { toast } from "sonner";

import type { PlatformTailscale } from "@/platform";
import { usePlatform } from "@/platform-context";

function ShareTailscaleStatus({
  onClose,
  tailscale,
}: {
  onClose: () => void;
  tailscale: PlatformTailscale;
}): ReactElement {
  const [snapshotPromise, setSnapshotPromise] = useState(() => tailscale.snapshot());
  const snapshot = use(snapshotPromise);
  const [pending, setPending] = useState(false);

  const run = (action: () => Promise<void>, fallback: string) => {
    if (pending) return;
    setPending(true);
    void action()
      .then(() => {
        setSnapshotPromise(tailscale.snapshot());
        setPending(false);
      })
      .catch((error: unknown) => {
        setPending(false);
        toast.error(error instanceof Error ? error.message : fallback);
      });
  };

  return (
    <>
      <div className="flex flex-col gap-2 px-6 py-2 text-sm">
        {snapshot.httpsBaseUrl ? (
          <p className="font-mono text-xs break-all">{snapshot.httpsBaseUrl}</p>
        ) : (
          <p className="text-muted-foreground">
            {snapshot.loggedIn
              ? "Tailscale did not report a MagicDNS name."
              : "Tailscale is not logged in. Run tailscale up and try again."}
          </p>
        )}
        <p className="text-muted-foreground">
          {snapshot.serveEnabled
            ? "HTTPS Serve is enabled for the local daemon port."
            : "HTTPS Serve is off."}
        </p>
      </div>
      <DialogFooter>
        <Button disabled={pending} type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        {snapshot.serveEnabled ? (
          <Button
            disabled={pending}
            type="button"
            variant="outline"
            onClick={() =>
              run(() => tailscale.disableServe(), "Failed to disable Tailscale HTTPS.")
            }
          >
            {pending ? "Working…" : "Disable HTTPS"}
          </Button>
        ) : (
          <Button
            disabled={pending || !snapshot.loggedIn}
            type="button"
            onClick={() => run(() => tailscale.enableServe(), "Failed to enable Tailscale HTTPS.")}
          >
            {pending ? "Working…" : "Enable HTTPS"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

export function ShareTailscaleDialog({ onClose }: { onClose: () => void }): ReactElement {
  const tailscale = usePlatform().tailscale;

  if (!tailscale || !tailscale.client.available) return <></>;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share this computer</DialogTitle>
          <DialogDescription>
            Tailscale Serve publishes this machine&apos;s pie daemon at your MagicDNS name. Other
            devices still need the daemon token — this is not pairing. To open another machine on
            the tailnet, add it as an SSH host.
          </DialogDescription>
        </DialogHeader>
        <Suspense
          fallback={
            <div className="text-muted-foreground px-6 py-2 text-sm">Checking Tailscale…</div>
          }
        >
          <ShareTailscaleStatus onClose={onClose} tailscale={tailscale} />
        </Suspense>
      </DialogPopup>
    </Dialog>
  );
}
