import { Data } from "effect";

export class PullRequestMissingGh extends Data.TaggedError("PullRequestMissingGh") {}

export class PullRequestUnauthenticated extends Data.TaggedError("PullRequestUnauthenticated") {}

export class PullRequestRateLimited extends Data.TaggedError("PullRequestRateLimited") {}

export class PullRequestUnsupportedContext extends Data.TaggedError(
  "PullRequestUnsupportedContext",
) {}

export class PullRequestHostUnavailable extends Data.TaggedError("PullRequestHostUnavailable") {}

export class PullRequestInvalidResponse extends Data.TaggedError("PullRequestInvalidResponse") {}

export class PullRequestStaleContext extends Data.TaggedError("PullRequestStaleContext") {}

export class PullRequestUnsupportedAction extends Data.TaggedError(
  "PullRequestUnsupportedAction",
) {}

export class PullRequestActionOutcomeUnknown extends Data.TaggedError(
  "PullRequestActionOutcomeUnknown",
) {}

export class PullRequestHostRejected extends Data.TaggedError("PullRequestHostRejected") {}
