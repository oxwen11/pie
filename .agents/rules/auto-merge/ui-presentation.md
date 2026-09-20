# Presentation-only UI fixes

Allowed in `apps/app/**` when every hunk only:

- restores or refines existing presentation: overflow/bleed, alignment, truncation, spacing, stacking, responsive overflow/wrapping, hover/focus/hit-target glitches, class/style tokens, or native `title`/`aria-*` derived from existing values; or
- swaps a rendered icon glyph (e.g. another lucide icon component) with DOM structure, state, and handlers unchanged; or
- changes idle/hover/focus/open-state visibility of existing chrome (separators, resize handles, toggle indicators) via class/style tokens, with no new DOM, state, or handlers.

Any hunk in `packages/ui/src/**` skips the PR — shared-UI changes need human review.

Reject new components, screens, routes, features, user-facing copy, interaction flows, hooks, state, handlers, conditions/control flow, Effect flow, RPC/schema/wire, or routing.
