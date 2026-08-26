import type { GitBranch } from "@getpie/contract/git";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";

function splitBranchRefs(
  branches: ReadonlyArray<string>,
  remotes: ReadonlyArray<string>,
): { local: string[]; remote: string[] } {
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
  branch: GitBranch | undefined;
  value: string | null;
  onValueChange: (base: string) => void;
  disabled?: boolean;
}) {
  const refs = splitBranchRefs(branch?.branches ?? [], branch?.remotes ?? []);
  const items = (branch?.branches ?? []).map((name) => ({ label: name, value: name }));

  return (
    <Select
      disabled={disabled || branch === undefined || items.length === 0}
      items={items}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
      value={value}
    >
      <SelectTrigger
        aria-label="Base branch for worktree"
        className="hover:bg-accent w-auto min-w-0 justify-self-start border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent"
        size="sm"
      >
        <SelectValue placeholder="Base branch" />
      </SelectTrigger>
      <SelectContent>
        {refs.local.length > 0 ? (
          <SelectGroup>
            <SelectGroupLabel>Local</SelectGroupLabel>
            {refs.local.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
        {refs.remote.length > 0 ? (
          <SelectGroup>
            <SelectGroupLabel>Remote</SelectGroupLabel>
            {refs.remote.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
      </SelectContent>
    </Select>
  );
}
