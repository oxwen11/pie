import { Input } from "@getpie/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";

export type DraftWorkspaceMode = "project" | "worktree";

export function DraftWorkspaceSelect({
  mode,
  onModeChange,
  branch,
  onBranchChange,
  disabled,
  gitAvailable,
}: {
  mode: DraftWorkspaceMode;
  onModeChange: (mode: DraftWorkspaceMode) => void;
  branch: string;
  onBranchChange: (branch: string) => void;
  disabled?: boolean;
  gitAvailable: boolean;
}) {
  if (!gitAvailable) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select
        disabled={disabled}
        items={[
          { label: "Current directory", value: "project" },
          { label: "New worktree", value: "worktree" },
        ]}
        onValueChange={(next) => {
          if (next === "project" || next === "worktree") onModeChange(next);
        }}
        value={mode}
      >
        {/* Match ProjectSelect: ghost trigger so it sits as a header action, not a second form field. */}
        <SelectTrigger
          className="hover:bg-accent w-auto min-w-0 border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="project">Current directory</SelectItem>
          <SelectItem value="worktree">New worktree</SelectItem>
        </SelectContent>
      </Select>
      {mode === "worktree" ? (
        <Input
          className="h-8 max-w-40 min-w-0"
          disabled={disabled}
          onChange={(event) => onBranchChange(event.target.value)}
          placeholder="Branch (optional)"
          value={branch}
        />
      ) : null}
    </div>
  );
}
