import type { Project } from "@getpie/contract";
import { Button } from "@getpie/ui/components/button";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "@getpie/ui/components/command";
import { Kbd, KbdGroup } from "@getpie/ui/components/kbd";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CornerLeftUpIcon,
  FolderIcon,
  FolderPlusIcon,
  Laptop,
  Server,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EnvironmentOrpcProvider, useCatalogOrpc } from "@/lib/environment-orpc";

import {
  isProjectDirectoryEntryVisible,
  type ProjectDirectoryEntry,
  projectDirectoryEntryMatches,
} from "./project-directory-filter";
import { type ConnectedEnvironment, useConnectedEnvironments } from "./use-connected-environments";

/**
 * Command-palette folder browser: pick an Environment when more than one is
 * connected, then drill into a folder and import it on that Environment.
 * Mount only while open — browsing state resets by unmounting on close.
 */
export function ImportProjectDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  /** Fires after a successful import, with the created (or deduped) project. */
  onImported?: (project: Project, environmentId: string) => void;
}) {
  const { environmentRpc } = useRouteContext({ from: "__root__" });
  const environments = useConnectedEnvironments();
  const [environmentId, setEnvironmentId] = useState<string | null>(
    environments.length === 1 ? (environments[0]?.environmentId ?? null) : null,
  );

  if (environmentId === null) {
    return (
      <PickEnvironmentDialog
        environments={environments}
        onClose={onClose}
        onPick={setEnvironmentId}
      />
    );
  }

  return (
    <EnvironmentOrpcProvider orpc={environmentRpc.for(environmentId)}>
      <ImportFolderDialog
        environmentId={environmentId}
        onBack={environments.length > 1 ? () => setEnvironmentId(null) : undefined}
        onClose={onClose}
        onImported={onImported}
      />
    </EnvironmentOrpcProvider>
  );
}

type EnvironmentItem = {
  value: string;
  /** Search haystack (title + description); display uses `title`. */
  label: string;
  title: string;
  description: string;
  kind: ConnectedEnvironment["kind"];
};

function CommandNavigateHint() {
  return (
    <KbdGroup className="items-center">
      <Kbd>
        <ArrowUpIcon />
      </Kbd>
      <Kbd>
        <ArrowDownIcon />
      </Kbd>
      <span>Navigate</span>
    </KbdGroup>
  );
}

function PickEnvironmentDialog({
  environments,
  onClose,
  onPick,
}: {
  environments: ReadonlyArray<ConnectedEnvironment>;
  onClose: () => void;
  onPick: (environmentId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const items = useMemo(
    () =>
      environments.map(
        (environment): EnvironmentItem => ({
          value: environment.environmentId,
          label: `${environment.title} ${environment.description}`,
          title: environment.title,
          description: environment.description,
          kind: environment.kind,
        }),
      ),
    [environments],
  );

  return (
    <CommandDialog open onOpenChange={(open) => !open && onClose()}>
      <CommandDialogPopup>
        <Command
          filter={projectDirectoryEntryMatches}
          items={items}
          onValueChange={setSearch}
          value={search}
        >
          <CommandInput placeholder="Search…" />
          <CommandPanel>
            <CommandEmpty>No Environments connected.</CommandEmpty>
            <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
              Environments
            </div>
            <CommandList>
              {(item: EnvironmentItem) => (
                <CommandItem
                  className="gap-2"
                  key={item.value}
                  onClick={() => onPick(item.value)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  value={item.value}
                >
                  {item.kind === "local" ? (
                    <Laptop className="text-muted-foreground size-4 shrink-0" />
                  ) : (
                    <Server className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{item.title}</span>
                    <span className="text-muted-foreground/70 truncate text-xs">
                      {item.description}
                    </span>
                  </span>
                </CommandItem>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-3">
              <CommandNavigateHint />
              <KbdGroup className="items-center">
                <Kbd>Enter</Kbd>
                <span>Select</span>
              </KbdGroup>
              <KbdGroup className="items-center">
                <Kbd>Esc</Kbd>
                <span>Close</span>
              </KbdGroup>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function ImportFolderDialog({
  environmentId,
  onBack,
  onClose,
  onImported,
}: {
  environmentId: string;
  onBack?: () => void;
  onClose: () => void;
  onImported?: (project: Project, environmentId: string) => void;
}) {
  // null = the server's default starting point (the home directory).
  const [path, setPath] = useState<string | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const orpcQueryUtils = useCatalogOrpc();
  const queryClient = useQueryClient();

  const listing = useQuery({
    ...orpcQueryUtils.fs.browse.queryOptions({
      input: path === null ? { includeHidden: true } : { path, includeHidden: true },
    }),
    placeholderData: keepPreviousData,
    select: (data) => ({
      path: data.path,
      entries: [
        ...(data.parent != null ? [{ value: data.parent, label: "..", kind: "up" as const }] : []),
        ...data.directories.map((d) => ({
          value: d.path,
          label: d.name,
          kind: "dir" as const,
        })),
      ] satisfies ProjectDirectoryEntry[],
    }),
  });
  const current = listing.data;
  const currentPath = current?.path;
  const inputValue = query ?? currentPath ?? "";

  const leafFilter = useMemo(() => {
    if (currentPath === undefined) return "";
    if (
      inputValue === currentPath ||
      inputValue === `${currentPath}/` ||
      inputValue === `${currentPath}\\`
    ) {
      return "";
    }
    if (inputValue.startsWith(currentPath)) {
      return inputValue.slice(currentPath.length).replace(/^[\\/]+/, "");
    }
    return inputValue;
  }, [currentPath, inputValue]);
  const entries = useMemo(
    () =>
      current?.entries.filter(
        (entry) =>
          isProjectDirectoryEntryVisible(entry, leafFilter) &&
          (leafFilter.length === 0 ||
            entry.kind === "up" ||
            entry.label.toLocaleLowerCase().includes(leafFilter.toLocaleLowerCase())),
      ) ?? [],
    [current?.entries, leafFilter],
  );

  const importProject = useMutation({
    mutationKey: orpcQueryUtils.project.create.key(),
    mutationFn: (target: string) => orpcQueryUtils.project.create.call({ path: target }),
    onSuccess: (project) => {
      onClose();
      onImported?.(project, environmentId);
      return queryClient.invalidateQueries({ queryKey: orpcQueryUtils.project.list.key() });
    },
    onError: (error) => {
      toast.error(`Failed to import project: ${error.message}`);
    },
  });

  const canImport = current !== undefined && !listing.isPlaceholderData && !importProject.isPending;

  return (
    <CommandDialog open onOpenChange={(open) => !open && onClose()}>
      <CommandDialogPopup>
        <Command
          autoHighlight={false}
          filter={() => true}
          items={entries}
          key={current?.path ?? "loading"}
          onValueChange={(next) => {
            setQuery(next);
            // Exact path typed with trailing separator → navigate.
            if (next !== current?.path && (next.endsWith("/") || next.endsWith("\\"))) {
              setQuery(null);
              setPath(next);
            }
          }}
          value={inputValue}
        >
          <div className="relative **:data-[slot=autocomplete-input]:pe-28!">
            <CommandInput
              placeholder="Enter path (e.g. ~/projects/my-app)"
              startAddon={
                onBack !== undefined ? (
                  <button
                    aria-label="Back"
                    className="pointer-events-auto flex cursor-pointer items-center"
                    onClick={onBack}
                    type="button"
                  >
                    <ArrowLeftIcon />
                  </button>
                ) : (
                  <FolderPlusIcon />
                )
              }
            />
            <Button
              aria-label="Add (Enter)"
              className="absolute inset-e-2.5 top-1/2 -translate-y-1/2"
              disabled={!canImport}
              onClick={() => current && importProject.mutate(current.path)}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              size="xs"
              tabIndex={-1}
              variant="outline"
            >
              <span>Add</span>
              <KbdGroup className="pointer-events-none -me-0.5 items-center">
                <Kbd>Enter</Kbd>
              </KbdGroup>
            </Button>
          </div>
          <CommandPanel>
            <CommandEmpty>{listing.isPending ? "Loading..." : "No folders found."}</CommandEmpty>
            <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">Directories</div>
            <CommandList>
              {(item: ProjectDirectoryEntry) => (
                <CommandItem
                  className="gap-2"
                  key={item.value}
                  onClick={() => {
                    setQuery(null);
                    setPath(item.value);
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  value={item.value}
                >
                  {item.kind === "up" ? (
                    <CornerLeftUpIcon className="text-muted-foreground size-4" />
                  ) : (
                    <FolderIcon className="text-muted-foreground size-4" />
                  )}
                  <span className="truncate">{item.label}</span>
                </CommandItem>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-3">
              <CommandNavigateHint />
              {onBack !== undefined ? (
                <KbdGroup className="items-center">
                  <Kbd>Backspace</Kbd>
                  <span>Back</span>
                </KbdGroup>
              ) : null}
              <KbdGroup className="items-center">
                <Kbd>Esc</Kbd>
                <span>Close</span>
              </KbdGroup>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
