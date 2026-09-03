import type { PullRequestDiff } from "@getpie/contract/pull-request";
import { Alert, AlertDescription, AlertTitle } from "@getpie/ui/components/alert";
import { Button } from "@getpie/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@getpie/ui/components/empty";
import { Spinner } from "@getpie/ui/components/spinner";
import { ORPCError } from "@orpc/client";
import type { UseQueryResult } from "@tanstack/react-query";
import { GitPullRequestIcon, type LucideIcon } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";

import { countDiffFiles } from "./pull-request-presentation";

const PullRequestDiffAdapter = lazy(() =>
  import("./pull-request-diff-adapter").then((module) => ({
    default: module.PullRequestDiffAdapter,
  })),
);

export function PullRequestDiffPane({
  diff,
  baseBranch,
}: {
  diff: UseQueryResult<PullRequestDiff>;
  baseBranch: string;
}) {
  if (diff.isPending && diff.data === undefined) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="text-muted-foreground size-4" />
      </div>
    );
  }

  if (diff.isError && diff.data === undefined) {
    return (
      <DiffState title={diffErrorTitle(diff.error)} onRetry={() => void diff.refetch()}>
        {diffErrorMessage(diff.error)}
      </DiffState>
    );
  }

  const patch = diff.data?.patch ?? "";
  const truncated = diff.data?.truncated ?? false;
  if (countDiffFiles(patch) === 0) {
    return (
      <DiffState prominentIcon title={truncated ? "Diff preview unavailable" : "No file changes"}>
        {truncated
          ? "Changed files are binary or too large to preview."
          : `This pull request has no file changes against ${baseBranch}.`}
      </DiffState>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {truncated ? (
        <Alert className="shrink-0 rounded-none border-x-0 border-t-0" variant="warning">
          <AlertTitle>Diff is incomplete</AlertTitle>
          <AlertDescription>
            Some files are binary, too large, or beyond what GitHub returned in this preview.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner className="text-muted-foreground size-4" />
            </div>
          }
        >
          <PullRequestDiffAdapter patch={patch} />
        </Suspense>
      </div>
    </div>
  );
}

function DiffState({
  title,
  children,
  onRetry,
  icon: Icon = GitPullRequestIcon,
  prominentIcon = false,
}: {
  title: string;
  children: ReactNode;
  onRetry?: () => void;
  icon?: LucideIcon;
  prominentIcon?: boolean;
}) {
  return (
    <Empty className="py-8 md:py-8">
      <EmptyHeader>
        <EmptyMedia className={prominentIcon ? "size-12" : undefined} variant="icon">
          <Icon className={prominentIcon ? "size-6" : undefined} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button onClick={onRetry} size="sm" variant="outline">
            Try again
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

function diffErrorTitle(error: Error): string {
  if (!(error instanceof ORPCError)) return "Unable to load diff";
  switch (error.code) {
    case "MISSING_GH":
      return "GitHub CLI not installed";
    case "UNAUTHENTICATED":
      return "GitHub CLI not authenticated";
    case "UNSUPPORTED_CONTEXT":
      return "Unsupported Git workspace";
    default:
      return "Unable to load diff";
  }
}

function diffErrorMessage(error: Error): string {
  if (!(error instanceof ORPCError)) return error.message;
  switch (error.code) {
    case "MISSING_GH":
      return "Install gh, then reopen or refresh this panel.";
    case "UNAUTHENTICATED":
      return "Run gh auth login in a terminal, then retry.";
    case "RATE_LIMITED":
      return "GitHub rate limiting is active. Wait, then retry.";
    case "UNSUPPORTED_CONTEXT":
      return "Check out a branch with a GitHub remote and try again.";
    case "INVALID_RESPONSE":
      return "The installed gh version returned data pie could not understand.";
    default:
      return error.message;
  }
}
