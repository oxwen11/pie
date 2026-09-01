# verify-runtime

Shim. Shared TypeScript for the three Pie verification skills lives in
`tools/verify-pie-cli` and is imported as `@getpie/verify-pie-cli/runtime`.
Skills invoke that package through **`pnpm exec pie-verify web|cli|desktop`**
(root `devDependency`). Do not add skill-local helpers.

This directory re-exports bootstrap/runtime so older relative imports still
resolve. Lives under `.agents/skills` like the other verify trees;
`.cursor/skills/verify-runtime` is a symlink. **Not a fourth surface:** no
`/tmp` home, no ports, no launch. **Not Bun.**
