import type { PullRequestCheck } from "@getpie/contract/pull-request";
import { ExternalLinkIcon } from "lucide-react";

import { PullRequestCheckIcon } from "./pull-request-check-icon";
import { checkStatusLabel } from "./pull-request-presentation";

export function PullRequestCheckRow({ check }: { check: PullRequestCheck }) {
  const contents = (
    <>
      <PullRequestCheckIcon status={check.status} />
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
