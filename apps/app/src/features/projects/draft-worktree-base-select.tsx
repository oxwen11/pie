import type { GitRepositoryBranch } from "@getpie/contract/git";
import { Button } from "@getpie/ui/components/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxFilter,
} from "@getpie/ui/components/combobox";
import { ChevronsUpDownIcon, SearchIcon } from "lucide-react";
import { useCallback } from "react";

type SplitRefs = {
  local: string[];
  remote: string[];
};

type BranchGroup = {
  label: string;
  items: string[];
};

function splitBranchRefs(
  branches: ReadonlyArray<string>,
  remotes: ReadonlyArray<string>,
): SplitRefs {
  const remoteSet = new Set(remotes);
  const local: string[] = [];
  const remote: string[] = [];
  for (const name of branches) {
    if (remoteSet.has(name)) remote.push(name);
    else local.push(name);
  }
  return { local, remote };
}

export function DraftWorktreeBaseSelect({
  branch,
  value,
  onValueChange,
  disabled,
}: {
  branch: GitRepositoryBranch | undefined;
  value: string | null;
  onValueChange: (base: string) => void;
  disabled?: boolean;
}) {
  const filter = useComboboxFilter();
  const refs = splitBranchRefs(branch?.branches ?? [], branch?.remotes ?? []);
  const groups: BranchGroup[] = [];
  if (refs.local.length > 0) groups.push({ label: "Local", items: refs.local });
  if (refs.remote.length > 0) groups.push({ label: "Remote", items: refs.remote });

  const matchesQuery = useCallback(
    (name: string, query: string) => filter.contains(name, query),
    [filter],
  );

  return (
    <Combobox
      autoHighlight
      disabled={disabled || branch === undefined || groups.length === 0}
      filter={matchesQuery}
      items={groups}
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
      value={value}
    >
      <ComboboxTrigger
        aria-label="Base branch for worktree"
        className="data-placeholder:text-muted-foreground w-auto max-w-56 min-w-0 justify-self-start font-normal"
        render={<Button size="sm" variant="ghost" />}
        title={value ?? undefined}
      >
        <ComboboxValue placeholder="Base branch">
          {(name: string | null) => <span className="truncate">{name ?? "Base branch"}</span>}
        </ComboboxValue>
        <ChevronsUpDownIcon />
      </ComboboxTrigger>
      <ComboboxPopup aria-label="Base branch options" className="min-w-64">
        <div className="border-b px-2 py-1.5">
          <ComboboxInput
            aria-label="Search branches"
            autoFocus
            className="border-transparent! bg-transparent! shadow-none before:hidden has-focus-visible:ring-0"
            placeholder="Search branches…"
            showTrigger={false}
            size="sm"
            startAddon={<SearchIcon />}
          />
        </div>
        <ComboboxEmpty className="text-muted-foreground text-center text-sm">
          No matching branches.
        </ComboboxEmpty>
        <div className="min-h-0 flex-1">
          <ComboboxList>
            {(group: BranchGroup) => (
              <ComboboxGroup items={group.items} key={group.label}>
                <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
                <ComboboxCollection>
                  {(name: string) => (
                    <ComboboxItem key={name} value={name}>
                      {name}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </div>
      </ComboboxPopup>
    </Combobox>
  );
}
