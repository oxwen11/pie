import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@getpie/ui/components/menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@getpie/ui/components/sidebar";
import { Check, Laptop, Plus, Server, Share2 } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { toast } from "sonner";

import { AddSshHostDialog } from "@/features/connections/add-ssh-host-dialog";
import { ShareTailscaleDialog } from "@/features/connections/share-tailscale-dialog";
import { LOCAL_ENVIRONMENT_ID, type EnvironmentSnapshot } from "@/platform";
import { usePlatform } from "@/platform-context";

const MISSING_SNAPSHOT: EnvironmentSnapshot = {
  revision: 0,
  activeId: LOCAL_ENVIRONMENT_ID,
  connectingLabel: null,
  remotes: [],
};

const subscribeNoop = (): (() => void) => () => {};
const getMissingSnapshot = (): EnvironmentSnapshot => MISSING_SNAPSHOT;

type PendingDialog = "add" | "share";

function sshErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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
  const activeRemote = environments.remotes.find((remote) => remote.id === environments.activeId);
  const label = activeRemote?.label ?? "This computer";
  const connecting = environments.connectingLabel !== null;
  const canLaunch = launch.available;

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
            <MenuTrigger disabled={connecting} render={<SidebarMenuButton />}>
              {activeRemote ? <Server /> : <Laptop />}
              <span>{environments.connectingLabel ?? label}</span>
            </MenuTrigger>
            <MenuPopup align="start" className="min-w-56">
              <MenuItem
                disabled={connecting}
                onClick={() => {
                  if (environments.activeId !== LOCAL_ENVIRONMENT_ID) {
                    void ssh.disconnect().catch((error: unknown) => {
                      toast.error(sshErrorMessage(error, "Failed to disconnect SSH."));
                    });
                  }
                }}
              >
                {environments.activeId === LOCAL_ENVIRONMENT_ID ? <Check /> : <Laptop />}
                <span>This computer</span>
              </MenuItem>
              {environments.remotes.map((remote) => (
                <MenuItem
                  disabled={connecting || !canLaunch}
                  key={remote.id}
                  onClick={() => {
                    if (remote.id !== environments.activeId) {
                      void ssh.connect(remote.alias).catch((error: unknown) => {
                        toast.error(sshErrorMessage(error, "Failed to connect over SSH."));
                      });
                    }
                  }}
                >
                  {remote.id === environments.activeId ? <Check /> : <Server />}
                  <span>{remote.label}</span>
                </MenuItem>
              ))}
              <MenuSeparator />
              {launch.available ? (
                <MenuItem
                  disabled={connecting}
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
                  disabled={connecting}
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
              {activeRemote ? (
                <MenuItem
                  disabled={connecting}
                  variant="destructive"
                  onClick={() => {
                    void ssh.remove(activeRemote.id).catch((error: unknown) => {
                      toast.error(sshErrorMessage(error, "Failed to remove SSH host."));
                    });
                  }}
                >
                  <span>Remove {activeRemote.label}</span>
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
        </SidebarMenuItem>
      </SidebarMenu>
      {addOpen ? <AddSshHostDialog onClose={() => setAddOpen(false)} /> : null}
      {shareOpen ? <ShareTailscaleDialog onClose={() => setShareOpen(false)} /> : null}
    </>
  );
}
