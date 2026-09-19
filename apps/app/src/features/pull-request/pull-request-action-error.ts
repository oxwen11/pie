import { ORPCError } from "@orpc/client";

export function pullRequestActionError(error: Error): string {
  if (!(error instanceof ORPCError)) return `Pull request action failed: ${error.message}`;
  switch (error.code) {
    case "STALE_CONTEXT":
      return "The pull request changed. Refresh and confirm the action again.";
    case "UNSUPPORTED_ACTION":
      return "Update GitHub CLI before performing this action safely.";
    case "OUTCOME_UNKNOWN":
      return "Could not confirm whether GitHub applied the action. Check GitHub before retrying.";
    case "HOST_UNAVAILABLE":
      return "GitHub could not be reached before the action started. Try again later.";
    case "INVALID_RESPONSE":
      return "GitHub returned data pie could not safely use. Refresh before retrying.";
    case "UNAUTHENTICATED":
      return "Run gh auth login, then try again.";
    case "RATE_LIMITED":
      return "GitHub rate limiting is active. Wait, then retry.";
    default:
      return "GitHub rejected the pull request action.";
  }
}
