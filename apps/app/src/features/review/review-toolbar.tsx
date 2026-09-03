import type { GitRepositoryBranch, GitReviewMode } from "@getpie/contract/git";
import { Button } from "@getpie/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@getpie/ui/components/select";
import { cn } from "@getpie/ui/lib/utils";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { REVIEW_MODE_ITEMS, splitCompareRefs } from "./review-file-status";

function GhostSelectTrigger({
  className,
  placeholder,
  ...props
}: Omit<ComponentProps<typeof SelectTrigger>, "render"> & {
  placeholder?: string;
}) {
  // Drop SelectTrigger's field chrome and its hard-coded up/down icon.
  return (
    <SelectTrigger
      {...props}
      render={({ children: _children, className: _className, ...triggerProps }) => (
        <Button
          {...triggerProps}
          className={cn("min-w-0 gap-1 px-2 font-normal", className)}
          size="sm"
          variant="ghost"
        >
          <SelectValue placeholder={placeholder} />
          <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
        </Button>
      )}
    />
  );
}

export type ReviewToolbarProps = ComponentProps<"div">;

export function ReviewToolbar({ className, ...props }: ReviewToolbarProps): ReactNode {
  return <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)} {...props} />;
}

export type ReviewModeSelectProps = {
  value: GitReviewMode;
  onValueChange: (mode: GitReviewMode) => void;
};

export function ReviewModeSelect({ value, onValueChange }: ReviewModeSelectProps): ReactNode {
  return (
    <Select
      items={[...REVIEW_MODE_ITEMS]}
      onValueChange={(next) => {
        if (next === "uncommitted" || next === "committed" || next === "branch") {
          onValueChange(next);
        }
      }}
      value={value}
    >
      <GhostSelectTrigger aria-label="Compare mode" className="w-auto shrink-0" />
      <SelectContent alignItemWithTrigger={false}>
        {REVIEW_MODE_ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type ReviewBranchSelectProps = {
  branch: GitRepositoryBranch | undefined;
  value: string | undefined;
  onValueChange: (other: string) => void;
};

export function ReviewBranchSelect({
  branch,
  value,
  onValueChange,
}: ReviewBranchSelectProps): ReactNode {
  const refs = splitCompareRefs(branch?.branches ?? [], branch?.remotes ?? []);
  const otherValue = value ?? branch?.defaultBranch ?? null;
  const otherItems = (branch?.branches ?? []).map((name) => ({ label: name, value: name }));

  return (
    <Select
      disabled={branch === undefined || otherItems.length === 0}
      items={otherItems}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
      value={otherValue}
    >
      <GhostSelectTrigger
        aria-label="Compare with branch"
        className="min-w-0 flex-1"
        placeholder="Select a branch"
      />
      <SelectContent alignItemWithTrigger={false}>
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

export type ReviewToolbarHeadingProps = {
  children: string;
};

export function ReviewToolbarHeading({ children }: ReviewToolbarHeadingProps): ReactNode {
  return (
    <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={children}>
      {children}
    </p>
  );
}

export type ReviewRefreshButtonProps = {
  loading: boolean;
  onClick: () => void;
};

export function ReviewRefreshButton({ loading, onClick }: ReviewRefreshButtonProps): ReactNode {
  return (
    <Button
      aria-label="Reload review"
      className="shrink-0"
      disabled={loading}
      onClick={onClick}
      size="icon-xs"
      variant="ghost"
    >
      <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
    </Button>
  );
}
