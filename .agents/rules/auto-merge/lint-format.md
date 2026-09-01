# Lint and format hygiene

Allowed even in `apps/**` or `packages/*/src/**` for mechanical oxlint/oxfmt, import-order, type-assertion, `satisfies`, empty-spread, lint-disable, or vendored `tools/` plugin changes.

Reject new branches; changed conditions, `return`, `throw`, `await`, or Effect flow; RPC/schema/wire changes; and UI copy or interaction changes.
