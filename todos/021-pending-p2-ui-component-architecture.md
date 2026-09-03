---
status: pending
priority: p2
issue_id: "021"
tags: [ui, architecture, compound-components, props]
dependencies: []
---

# UI component architecture and prop drilling

## Problem Statement

The UI already uses compound components in several places, but the architecture is inconsistent. Some components carry dead props, some pass state or callbacks through multiple layers, and several feature components duplicate the same layout or state presentation. This makes behavior harder to change safely and leaves public component contracts wider than necessary.

## Planned Stacked Sequence

- [x] Remove the dead `UIMessage` / `message` prop chain from `AssistantMessage` → `ToolBatch` → `ToolPart`.
- [x] Remove agent-request response callback drilling from `ChatTranscript` → `AgentRequestView` → request-specific views.
- [x] Consolidate the duplicated responsive File/Review workspace layouts into one shared layout boundary.
- [x] Remove current-session detection prop drilling through the projects sidebar with a narrowly scoped provider or equivalent boundary.
- [x] Stop passing the Content Panel session object through outlet children when the existing Content Panel context already provides it.
- [x] Consolidate `FileState`, `ReviewState`, and `WorkspaceState` into one shared state presentation component.
- [x] Decompose `ReviewToolbar` into focused, explicitly composable controls while preserving controlled state ownership.
- [ ] Clean up the `PromptInput` and `ToolHeader` public APIs, including unused props and unnecessary mode/configuration surface.
- [ ] Correct and verify the `Branch` and `WebPreview` compound-component contracts, including controlled state and child/state synchronization.

## Acceptance Criteria

- [ ] Each stacked change has a single coherent scope and preserves existing user-visible behavior.
- [ ] Components expose only dependencies they actually consume; callback or state drilling is removed only where a local composition boundary is clearer than explicit props.
- [ ] Shared layouts and state presentations have one canonical implementation rather than feature-level copies.
- [ ] Compound components use clear Root/Trigger/Content-style boundaries, shared state through a narrow context, and controlled/uncontrolled state where applicable.
- [ ] No vendored Coss base component is edited directly; fixes remain in app code or hand-maintained wrappers.
- [ ] Focused tests are added or updated when a public behavior seam benefits from them; type-only shape tests are not added.
- [ ] Every stacked PR passes the relevant app/UI typecheck and test commands, plus any focused runtime verification required by the changed surface.

## Verification Expectations

- Run `pnpm turbo run typecheck --filter=@getpie/app` after each app-level stack item.
- Run `pnpm turbo run test --filter=@getpie/app` after each app-level stack item.
- Run the corresponding `@getpie/ui` typecheck/test commands for changes under `packages/ui`.
- Run `npx react-doctor@latest --verbose --scope changed` before committing React changes and confirm no regression.
- Inspect the final diff for scope creep and confirm there are no staged files before creating each stacked PR.
- Use `pnpm exec pie-verify web` for runtime checks when a change affects a user-facing web flow.

## Work Log

| Date       | Action                                                                    | Learnings                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-23 | Identified via UI component architecture review                           | The first safe slice is deleting a prop chain that has no behavior.                                                                                      |
| 2026-08-23 | Removed dead `message` props from the assistant transcript tool path      | `ToolPart` never consumed the message; `AssistantMessage` and `ToolBatch` only forwarded it.                                                             |
| 2026-08-23 | Moved agent-request response ownership to `AgentRequestView`              | The transcript remains a pure snapshot view while request leaves retain an explicit action prop at one level.                                            |
| 2026-08-23 | Consolidated responsive File/Review workspace layouts                     | One app-level layout now owns width observation, drawer behavior, and split sizing while explicit labels and trigger placement remain at each call site. |
| 2026-08-23 | Removed current-session detection prop drilling from the projects sidebar | A projects-scoped provider keeps route identity at the root while rows and archive actions read a complete `SessionRef` checker locally.                 |
| 2026-08-23 | Stopped forwarding the Content Panel session through outlet internals     | Outlet children now read the existing bound session hook instead of repeating the same object as props.                                                  |
| 2026-08-23 | Consolidated File/Review/Workspace empty states                           | One app-level `WorkspaceState` now owns empty/error presentation; features pass icon and variant.                                                        |
| 2026-08-23 | Split `ReviewToolbar` into composable controls                            | Mode, branch, heading, and refresh stay independently controlled; the toolbar is only a layout row.                                                      |
