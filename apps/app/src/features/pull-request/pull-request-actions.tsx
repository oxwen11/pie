import type { PullRequestAction, PullRequestSnapshot } from "@getpie/contract/pull-request";
import { Button } from "@getpie/ui/components/button";
import { GitMergeIcon } from "lucide-react";

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
  if (snapshot.offeredActions.length === 0) return null;
  return (
    <section aria-labelledby="pull-request-actions" className="flex flex-col gap-2">
      <h2 id="pull-request-actions" className="text-sm font-semibold">
        Actions
      </h2>
      <div className="flex flex-wrap gap-2">
        {snapshot.offeredActions.flatMap((offered) => {
          if (offered.type === "disable-auto-merge") {
            return [
              <Button
                disabled={disabled}
                key={offered.type}
                onClick={() => onAction({ type: "disable-auto-merge" })}
                size="sm"
                variant="outline"
              >
                Disable auto-merge
              </Button>,
            ];
          }
          return offered.methods.map((method) => (
            <Button
              disabled={disabled}
              key={`${offered.type}:${method}`}
              onClick={() => onAction({ type: offered.type, method })}
              size="sm"
              variant={offered.type === "merge" ? "default" : "outline"}
            >
              <GitMergeIcon />
              {offered.type === "merge"
                ? mergeMethodActionLabel(method)
                : `Auto · ${mergeMethodLabel(method)}`}
            </Button>
          ));
        })}
      </div>
    </section>
  );
}
