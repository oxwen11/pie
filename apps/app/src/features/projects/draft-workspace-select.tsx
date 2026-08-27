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
  disabled,
}: {
  mode: DraftWorkspaceMode;
  onModeChange: (mode: DraftWorkspaceMode) => void;
  disabled?: boolean;
}) {
  return (
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
      {/* Match ProjectSelect: ghost trigger aligned with other draft header picks. */}
      <SelectTrigger
        className="hover:bg-accent w-auto max-w-56 min-w-0 justify-self-start border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent"
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="project">Current directory</SelectItem>
        <SelectItem value="worktree">New worktree</SelectItem>
      </SelectContent>
    </Select>
  );
}
