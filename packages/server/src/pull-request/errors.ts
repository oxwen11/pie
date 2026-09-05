import { Schema } from "effect";

export class PullRequestMissingGh extends Schema.TaggedError<PullRequestMissingGh>()(
  "PullRequestMissingGh",
  {},
) {}

export class PullRequestUnauthenticated extends Schema.TaggedError<PullRequestUnauthenticated>()(
  "PullRequestUnauthenticated",
  {},
) {}

export class PullRequestRateLimited extends Schema.TaggedError<PullRequestRateLimited>()(
  "PullRequestRateLimited",
  {},
) {}

export class PullRequestUnsupportedContext extends Schema.TaggedError<PullRequestUnsupportedContext>()(
  "PullRequestUnsupportedContext",
  {},
) {}

export class PullRequestHostUnavailable extends Schema.TaggedError<PullRequestHostUnavailable>()(
  "PullRequestHostUnavailable",
  {},
) {}

export class PullRequestInvalidResponse extends Schema.TaggedError<PullRequestInvalidResponse>()(
  "PullRequestInvalidResponse",
  {
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class PullRequestStaleContext extends Schema.TaggedError<PullRequestStaleContext>()(
  "PullRequestStaleContext",
  {},
) {}

export class PullRequestUnsupportedAction extends Schema.TaggedError<PullRequestUnsupportedAction>()(
  "PullRequestUnsupportedAction",
  {},
) {}

export class PullRequestActionOutcomeUnknown extends Schema.TaggedError<PullRequestActionOutcomeUnknown>()(
  "PullRequestActionOutcomeUnknown",
  {},
) {}

export class PullRequestHostRejected extends Schema.TaggedError<PullRequestHostRejected>()(
  "PullRequestHostRejected",
  {},
) {}
