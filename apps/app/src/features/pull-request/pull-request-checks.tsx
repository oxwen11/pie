import type {
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestSnapshot,
} from "@getpie/contract/pull-request";
import {
  CheckCircle2Icon,
  CircleMinusIcon,
  Clock3Icon,
  ExternalLinkIcon,
  XCircleIcon,
} from "lucide-react";

import { checkStatusLabel } from "./pull-request-presentation";

function CheckIcon({ status }: { status: PullRequestCheckStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2Icon className="text-success size-4" />;
    case "failure":
    case "cancelled":
      return <XCircleIcon className="text-destructive size-4" />;
    case "pending":
      return <Clock3Icon className="text-warning size-4" />;
    case "skipped":
    case "neutral":
      return <CircleMinusIcon className="text-muted-foreground size-4" />;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function CheckRow({ check }: { check: PullRequestCheck }) {
  const contents = (
    <>
      <CheckIcon status={check.status} />
      <span className="min-w-0 flex-1 truncate">{check.name}</span>
      <span className="text-muted-foreground text-xs">{checkStatusLabel(check.status)}</span>
      {check.url === null ? null : <ExternalLinkIcon className="size-3.5" />}
    </>
  );
  return (
    <li className="text-sm">
      {check.url === null ? (
        <div className="flex min-h-10 items-center gap-2 px-3">{contents}</div>
      ) : (
        <a
          className="hover:bg-accent flex min-h-10 items-center gap-2 px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
          href={check.url}
          rel="noreferrer"
          target="_blank"
        >
          {contents}
        </a>
      )}
    </li>
  );
}

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
            <CheckRow check={check} key={`${check.name}:${check.url ?? ""}`} />
          ))}
        </ul>
      )}
    </section>
  );
}
