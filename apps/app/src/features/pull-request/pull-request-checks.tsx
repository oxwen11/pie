import type { PullRequestSnapshot } from "@getpie/contract/pull-request";

import { PullRequestCheckRow } from "./pull-request-check-row";

export function PullRequestChecks({ snapshot }: { snapshot: PullRequestSnapshot }) {
  return (
    <section aria-labelledby="pull-request-checks" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pull-request-checks" className="text-sm font-semibold">
          Checks
        </h2>
        <span className="text-muted-foreground text-xs">{snapshot.checks.items.length}</span>
      </div>
      {snapshot.checks.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No checks reported.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {snapshot.checks.items.map((check) => (
            <PullRequestCheckRow check={check} key={`${check.name}:${check.url ?? ""}`} />
          ))}
        </ul>
      )}
    </section>
  );
}
