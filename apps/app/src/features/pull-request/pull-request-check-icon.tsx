import type { PullRequestCheckStatus } from "@getpie/contract/pull-request";
import { CheckCircle2Icon, CircleMinusIcon, Clock3Icon, XCircleIcon } from "lucide-react";

export function PullRequestCheckIcon({ status }: { status: PullRequestCheckStatus }) {
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
