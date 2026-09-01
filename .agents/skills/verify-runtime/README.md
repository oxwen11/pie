# verify-runtime

Shim. Shared TypeScript for the three Pie verification skills lives in
`tools/verify-pie-cli` and is imported as `@getpie/verify-pie-cli/runtime`.

This directory only re-exports that package so existing skill `src/*.ts`
imports keep working. Lives under `.agents/skills` like the other verify
trees; `.cursor/skills/verify-runtime` is a symlink. **Not a fourth
surface:** no `/tmp` home, no ports, no launch. **Not Bun.**
