import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@getpie/ui/components/menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@getpie/ui/components/sidebar";
import { Spinner } from "@getpie/ui/components/spinner";
import { Laptop, Plus, Server, Share2 } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { toast } from "sonner";

import { AddSshHostDialog } from "@/features/connections/add-ssh-host-dialog";
import { ShareTailscaleDialog } from "@/features/connections/share-tailscale-dialog";
import type { EnvironmentSnapshot } from "@/platform";
import { usePlatform } from "@/platform-context";

const MISSING_SNAPSHOT: EnvironmentSnapshot = {
  revision: 0,
  connecting: [],
  remotes: [],
};

const subscribeNoop = (): (() => void) => () => {};
const getMissingSnapshot = (): EnvironmentSnapshot => MISSING_SNAPSHOT;

type PendingDialog = "add" | "share";

function sshErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function connectionsLabel(snapshot: EnvironmentSnapshot): string {
  const [only] = snapshot.connecting;
  if (only !== undefined && snapshot.connecting.length === 1) {
    return `Connecting ${only.target}…`;
  }
  if (snapshot.connecting.length > 1) {
    return `Connecting ${String(snapshot.connecting.length)} hosts…`;
  }
  if (snapshot.remotes.length === 0) return "Connections";
  return `${String(snapshot.remotes.length)} connected`;
}

export function ConnectionSwitcher(): ReactElement | null {
  const { ssh, tailscale } = usePlatform();
  const environments = useSyncExternalStore(
    ssh?.environments.subscribe ?? subscribeNoop,
    ssh?.environments.getSnapshot ?? getMissingSnapshot,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const pendingDialog = useRef<PendingDialog | null>(null);

  if (!ssh) return null;

  const launch = ssh.client;
  const blocking = environments.connecting.some((entry) => entry.blocking);

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <Menu
            onOpenChange={(open) => {
              if (open) return;
              const pending = pendingDialog.current;
              pendingDialog.current = null;
              if (pending === null) return;
              // The item click also restores focus to the menu trigger. Mounting
              // the dialog in that turn lets Dialog treat the restore as focus
              // leaving the popup and unmount it — the click looks dead.
              window.setTimeout(() => {
                switch (pending) {
                  case "add":
                    setAddOpen(true);
                    break;
                  case "share":
                    setShareOpen(true);
                    break;
                  default: {
                    const exhaustive: never = pending;
                    return exhaustive;
                  }
                }
              }, 0);
            }}
          >
            <MenuTrigger render={<SidebarMenuButton />}>
              <Laptop />
              <span>{connectionsLabel(environments)}</span>
            </MenuTrigger>
            <MenuPopup align="start" className="min-w-56">
              {environments.connecting.map((entry, index) => (
                <MenuItem disabled key={`connecting-${entry.target}-${String(index)}`}>
                  <Spinner />
                  <span>Connecting {entry.target}…</span>
                </MenuItem>
              ))}
              {environments.remotes.map((remote) => (
                <MenuItem disabled key={remote.id}>
                  <Server />
                  <span>{remote.label}</span>
                </MenuItem>
              ))}
              {environments.remotes.length > 0 || environments.connecting.length > 0 ? (
                <MenuSeparator />
              ) : null}
              {launch.available ? (
                <MenuItem
                  disabled={blocking}
                  onClick={() => {
                    pendingDialog.current = "add";
                  }}
                >
                  <Plus />
                  <span>Add SSH host…</span>
                </MenuItem>
              ) : (
                <MenuItem disabled title={launch.message}>
                  <span>OpenSSH client not found</span>
                </MenuItem>
              )}
              {tailscale === undefined ? null : tailscale.client.available ? (
                <MenuItem
                  disabled={blocking}
                  onClick={() => {
                    pendingDialog.current = "share";
                  }}
                >
                  <Share2 />
                  <span>Share this computer via Tailscale…</span>
                </MenuItem>
              ) : (
                <MenuItem disabled title={tailscale.client.message}>
                  <span>Tailscale client not found</span>
                </MenuItem>
              )}
              {environments.remotes.map((remote) => (
                <MenuItem
                  disabled={blocking}
                  key={`remove-${remote.id}`}
                  variant="destructive"
                  onClick={() => {
                    void ssh.remove(remote.id).catch((error: unknown) => {
                      toast.error(sshErrorMessage(error, "Failed to remove SSH host."));
                    });
                  }}
                >
                  <span>Remove {remote.label}</span>
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </SidebarMenuItem>
      </SidebarMenu>
      {addOpen ? <AddSshHostDialog onClose={() => setAddOpen(false)} /> : null}
      {shareOpen ? <ShareTailscaleDialog onClose={() => setShareOpen(false)} /> : null}
    </>
  );
}
