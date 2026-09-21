import type { PullRequestAction, PullRequestSnapshot } from "@getpie/contract/pull-request";
import { Button } from "@getpie/ui/components/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@getpie/ui/components/menu";
import { ChevronDownIcon, GitMergeIcon } from "lucide-react";

import { mergeMethodActionLabel, mergeMethodLabel } from "./pull-request-presentation";

export function PullRequestActions({
  disabled,
  onAction,
  snapshot,
}: {
  disabled: boolean;
  onAction: (action: PullRequestAction) => void;
  snapshot: PullRequestSnapshot;
}) {
  const available = snapshot.offeredActions.length > 0;
  const trigger = (
    <Button
      disabled={disabled || !available}
      render={available ? <MenuTrigger /> : undefined}
      size="sm"
      title={available ? undefined : "Merge is not currently available"}
    >
      <GitMergeIcon />
      Merge
      {available ? <ChevronDownIcon /> : null}
    </Button>
  );

  if (!available) return trigger;

  return (
    <Menu>
      {trigger}
      <MenuPopup align="end" className="min-w-48">
        {snapshot.offeredActions.flatMap((offered) => {
          if (offered.type === "disable-auto-merge") {
            return (
              <MenuItem key={offered.type} onClick={() => onAction({ type: "disable-auto-merge" })}>
                Disable auto-merge
              </MenuItem>
            );
          }
          return offered.methods.map((method) => (
            <MenuItem
              key={`${offered.type}:${method}`}
              onClick={() => onAction({ type: offered.type, method })}
            >
              {offered.type === "merge"
                ? mergeMethodActionLabel(method)
                : `Auto · ${mergeMethodLabel(method)}`}
            </MenuItem>
          ));
        })}
      </MenuPopup>
    </Menu>
  );
}
