# Ponytail — pie supplements

Generic ladder / tags / report shape live in the `ponytail-review` skill.
This file is only what that skill does not know about **this** repo.
Apply these on every complexity review of pie diffs.

## Contract / oRPC

- No-input procedures omit `.input()`. Do not add `Schema.Struct({})` "for
  symmetry".
- A one-value optional kind field is
  `Schema.optionalKey(Schema.Literal("…"))` on the struct — not a named
  `*TypeSchema` + exported alias until a second value exists.

## Server paths

- `WorkspacePathEscape` / `contains` belong on **caller-supplied** paths.
  Server-minted fixed relative names do not get escape guards.
- Leaf modules keep their helpers. Package barrels export Service / Repo
  tags, not every helper a leaf happens to export. Tests import the leaf.

## TanStack Query

- One query key with multiple `select`s → one thin hook per select.
- After the split, delete the unfiltered reader if it has zero callers.
  Do not keep `useX` (all rows) beside `useXFoo` / `useXBar` when nobody
  needs the unfiltered list.
- Name the resource hook for the select product surfaces actually use by
  default; only exceptional selects get a qualifier. Do not invent a
  middle adjective for the default select.

## UI lists

- Empty collections: return `null` / omit the chrome. Do not render a
  labeled group shell with zero rows.

## Already enforced elsewhere — do not re-flag as prose

oxlint `anti-slop` already fails: conditional empty-object spreads,
anonymous return-type widening, etc. Cite the lint if it fires; do not
duplicate those as ponytail findings.
