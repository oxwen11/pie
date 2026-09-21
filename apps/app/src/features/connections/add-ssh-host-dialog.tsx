import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@getpie/ui/components/autocomplete";
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
import { PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { toast } from "sonner";

import type { DiscoveredSshHost, PlatformSsh } from "@/platform";
import { usePlatform } from "@/platform-context";

import { composeSshConnectTarget } from "./ssh-connect-target";

const MISMATCH = "already running with a different version";

function discoveredHostAddress(host: DiscoveredSshHost): string {
  const authority = host.username ? `${host.username}@${host.hostname}` : host.hostname;
  return host.port === null ? authority : `${authority}:${String(host.port)}`;
}

function discoveredHostOptionLabel(host: DiscoveredSshHost): string {
  switch (host.source) {
    case "tailscale":
      return `${host.alias} (Tailscale)`;
    case "ssh-config":
      return host.alias;
    default: {
      const exhaustive: never = host.source;
      return exhaustive;
    }
  }
}

function hostMatchesQuery(host: DiscoveredSshHost, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    host.alias.toLowerCase().includes(needle) ||
    host.hostname.toLowerCase().includes(needle) ||
    (host.username?.toLowerCase().includes(needle) ?? false)
  );
}

function connectSsh(
  ssh: PlatformSsh,
  target: string,
  onClose: () => void,
  onIdle: () => void,
): void {
  void ssh
    .connect(target)
    .then(() => {
      onClose();
      return undefined;
    })
    .catch((error: unknown) => {
      onIdle();
      toast.error(
        error instanceof Error && error.message.includes(MISMATCH)
          ? "Pie on that machine is a different version. Update Pie there, then connect."
          : error instanceof Error
            ? error.message
            : "Failed to connect over SSH.",
      );
      return undefined;
    });
}

export function AddSshHostDialog({ onClose }: { onClose: () => void }): ReactElement | null {
  const ssh = usePlatform().ssh;
  if (!ssh || !ssh.client.available) return null;
  return <AddSshHostForm onClose={onClose} ssh={ssh} />;
}

function AddSshHostForm({ onClose, ssh }: { onClose: () => void; ssh: PlatformSsh }): ReactElement {
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState("");
  const [hosts, setHosts] = useState<readonly DiscoveredSshHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void ssh
      .discoverHosts()
      .then((discovered) => {
        if (!cancelled) setHosts(discovered);
        return undefined;
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to list SSH hosts.");
          setHosts([]);
        }
        return undefined;
      })
      .finally(() => {
        if (!cancelled) setHostsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ssh]);

  const filteredHosts = useMemo(
    () => hosts.filter((entry) => hostMatchesQuery(entry, host)),
    [host, hosts],
  );
  const showSuggestions = hostsLoading || filteredHosts.length > 0 || host.trim().length > 0;

  const connectTarget = (target: string) => {
    if (pending) return;
    setPending(true);
    connectSsh(ssh, target, onClose, () => setPending(false));
  };

  const submitManual = () => {
    try {
      connectTarget(composeSshConnectTarget({ host, username, port }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid SSH target.");
    }
  };

  const selectDiscovered = (entry: DiscoveredSshHost) => {
    const nextPort = entry.port === null ? "" : String(entry.port);
    setHost(entry.alias);
    setUsername(entry.username ?? "");
    setPort(nextPort);
    setSuggestionsOpen(false);
    connectTarget(
      composeSshConnectTarget({
        host: entry.alias,
        username: entry.username ?? "",
        port: nextPort,
      }),
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogPopup className="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitManual();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add SSH host</DialogTitle>
            <DialogDescription>
              Pie launches the remote pie daemon and forwards it over SSH. Use ssh-agent or an
              IdentityFile; password prompts are not wired yet.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-6 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ssh-host">SSH host or alias</Label>
              <HostPicker
                filteredHosts={filteredHosts}
                host={host}
                hostsLoading={hostsLoading}
                pending={pending}
                showSuggestions={showSuggestions}
                suggestionsOpen={suggestionsOpen}
                onHostChange={setHost}
                onOpenChange={setSuggestionsOpen}
                onSelect={selectDiscovered}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ssh-username">Username</Label>
                <Input
                  id="ssh-username"
                  autoComplete="off"
                  disabled={pending}
                  placeholder="root"
                  spellCheck={false}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ssh-port">Port</Label>
                <Input
                  id="ssh-port"
                  autoComplete="off"
                  disabled={pending}
                  inputMode="numeric"
                  placeholder="22"
                  spellCheck={false}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={pending} type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={pending || host.trim().length === 0} type="submit">
              <PlusIcon className="size-3.5" />
              {pending ? "Adding…" : "Add environment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function HostPicker({
  filteredHosts,
  host,
  hostsLoading,
  pending,
  showSuggestions,
  suggestionsOpen,
  onHostChange,
  onOpenChange,
  onSelect,
}: {
  filteredHosts: readonly DiscoveredSshHost[];
  host: string;
  hostsLoading: boolean;
  pending: boolean;
  showSuggestions: boolean;
  suggestionsOpen: boolean;
  onHostChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (entry: DiscoveredSshHost) => void;
}): ReactElement {
  return (
    <Autocomplete
      items={filteredHosts}
      itemToStringValue={(entry) => entry.alias}
      mode="none"
      open={suggestionsOpen && showSuggestions}
      openOnInputClick
      value={host}
      onOpenChange={onOpenChange}
      onValueChange={(value, eventDetails) => {
        onHostChange(value);
        if (eventDetails.reason !== "item-press") return;
        const entry = filteredHosts.find((candidate) => candidate.alias === value);
        if (entry) onSelect(entry);
      }}
    >
      <AutocompleteInput
        id="ssh-host"
        autoComplete="off"
        disabled={pending}
        placeholder="Search hosts or type user@host"
        spellCheck={false}
      />
      {showSuggestions ? (
        <HostSuggestions filteredHosts={filteredHosts} host={host} hostsLoading={hostsLoading} />
      ) : null}
    </Autocomplete>
  );
}

function HostSuggestions({
  filteredHosts,
  host,
  hostsLoading,
}: {
  filteredHosts: readonly DiscoveredSshHost[];
  host: string;
  hostsLoading: boolean;
}): ReactElement {
  if (hostsLoading) {
    return (
      <AutocompletePopup>
        <div className="text-muted-foreground px-3 py-2 text-xs">Loading hosts…</div>
      </AutocompletePopup>
    );
  }
  if (filteredHosts.length === 0) {
    return (
      <AutocompletePopup>
        <AutocompleteEmpty className="break-all">
          No hosts match &quot;{host.trim()}&quot;.
        </AutocompleteEmpty>
      </AutocompletePopup>
    );
  }
  return (
    <AutocompletePopup>
      <AutocompleteList className="max-h-72">
        {filteredHosts.map((entry) => {
          const address = discoveredHostAddress(entry);
          return (
            <AutocompleteItem
              key={`${entry.source}:${entry.alias}:${entry.hostname}:${entry.port ?? ""}`}
              className="h-8 min-h-8 whitespace-nowrap"
              value={entry}
            >
              <span className="min-w-0 truncate text-sm font-medium">
                {discoveredHostOptionLabel(entry)}
              </span>
              {address !== entry.alias ? (
                <span className="text-muted-foreground ms-2 min-w-0 flex-1 truncate text-xs">
                  {address}
                </span>
              ) : (
                <span className="flex-1" />
              )}
            </AutocompleteItem>
          );
        })}
      </AutocompleteList>
    </AutocompletePopup>
  );
}
