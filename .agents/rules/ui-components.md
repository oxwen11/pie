# UI components

## Accessibility and compatibility

- Preserve semantic HTML, valid nesting, keyboard operation, accessible names,
  labels, visible focus, and appropriate state announcements. Do not convey
  information through color alone; keep touch targets at least 44px.
- `packages/ui` uses Base UI, not Radix: use its `render` composition API rather
  than assuming `asChild`. Preserve supported caller props, refs, and handlers.
- `packages/ui/src/components/*` is vendored from coss and overwritten on refresh;
  `carousel` and `splitter` are local exceptions. Fix other components through
  wrappers or upstream. See the [vendoring ADR](../../docs/adr/0001-vendor-base-ui-components-from-coss-registry.md).
- Preserve shared component contracts and theme behavior. Follow the active
  lint configuration; do not add global tokens or shared variants solely to
  silence a feature-local styling diagnostic.

## Design defaults, not universal shapes

- Reuse suitable native elements and existing components. Compound components
  help when consumers need composition; a small standalone component is also fine.
  There is no one-element-per-component or mandatory taxonomy requirement.
- Support controlled/uncontrolled modes only when consumers need them. Do not
  add unused state modes, polymorphism, or public prop types for completeness.
- For native wrappers, forward supported attributes; caller props normally follow
  defaults. Compose handlers and classes explicitly when required behavior must
  survive overrides. Export types when they are useful to callers.
- Prefer existing semantic tokens and `cn` for class merging. Use `data-state`
  and `data-slot` for stable styling hooks where helpful, not as a required API
  for every component. Dynamic styles can use CSS variables.
- Keep feature styling local by default. A shared abstraction is justified by a
  real shared requirement, not an arbitrary minimum consumer count. Consider
  existing consumers before changing shared UI or global tokens.

Review usability and consumer needs, not conformity to a preferred component
shape. Runtime proof follows [verify-evidence.md](verify-evidence.md).
