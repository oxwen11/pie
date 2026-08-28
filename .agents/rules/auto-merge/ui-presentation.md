# Presentation-only UI fixes

Allowed in `apps/app/**` when every hunk only restores existing presentation: overflow/bleed, alignment, truncation, spacing, stacking, responsive overflow/wrapping, hover/focus/hit targets, class/style tokens, or native `title`/`aria-*` derived from existing values.

In `packages/ui/src/**`, component interface, DOM structure, default behavior, and theme/global styles must also remain unchanged.

Reject new components, screens, routes, features, user-facing copy, interaction flows, hooks, state, handlers, conditions/control flow, Effect flow, RPC/schema/wire, or routing.
