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

## Chosen pattern: compound components

Use compound components for multi-part UI. Give consumers composable pieces
rather than one widget controlled by a growing collection of boolean/config props.

- Share state and actions through an owning provider/context, not prop drilling
  between every piece. Keep the state implementation behind that provider.
- Use recognizable roles such as Root, Trigger, Content, Item, Header, and Footer.
  Each piece should have a focused responsibility and be independently composable.
- Prefer JSX children for structural composition. Render callbacks are appropriate
  when a parent supplies item data or state; Base UI's primitive `render` API remains valid.
- Reuse existing primitives. A simple button does not need artificial subcomponents
  or a context with no shared state.

Examples: [composition patterns](../skills/vercel-composition-patterns/SKILL.md).

## Component best practices

- Extend the wrapped element's native prop types; do not repurpose native attributes
  for unrelated meanings. Forward supported props after defaults, and preserve refs.
  Compose handlers explicitly where required behavior must survive caller overrides.
- Merge classes with `cn`: base → variants → state → caller `className`. Keep static
  variant definitions outside render. Use semantic theme tokens; dynamic values
  can use CSS variables rather than constructed Tailwind class names.
- Expose visual state through `data-state` and part identity through `data-slot`.
  Prefer these stable styling hooks to accumulating `openClassName`/per-state props.
- Document non-obvious public prop behavior and export types useful to consumers.
  Support controlled/uncontrolled modes when needed, without adding unused modes
  or polymorphism to every component.
- Keep feature styling local. Shared UI needs a real shared requirement, not an
  arbitrary consumer count; consider existing consumers before changing it.

Review both these practices and actual usability. Runtime proof follows
[verify-evidence.md](verify-evidence.md).
