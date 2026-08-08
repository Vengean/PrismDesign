# Prism Demo Agent Instructions

## Project context

- This project is the Prism browser-development and real-browser-verification demo.
- Stack: React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui, Express, and SQLite.
- Use `pnpm`; do not introduce another package manager or duplicate UI library.
- Preserve existing business behavior unless the user explicitly requests a behavior change.
- Make the smallest coherent change and reuse components from `src/components/ui/` before creating new primitives.

## Mandatory design guidance

Before planning or implementing any user-facing UI change, you MUST read [`DESIGN_SPEC.md`](./DESIGN_SPEC.md) completely.

All new pages, components, states, and responsive behavior MUST follow that specification. Treat it as the visual and interaction source of truth for this Demo. Do not introduce a conflicting color system, typography scale, radius language, shadow style, spacing rhythm, or interaction pattern.

If a user request conflicts with the design specification:

1. Follow the user's explicit requirement.
2. Preserve the rest of the design system.
3. Briefly identify the intentional exception in the handoff.

When changing an existing area that does not conform to the specification, do not redesign unrelated content. Bring touched elements into compliance only when it is necessary for a coherent result.

## Implementation rules

- Use function components and Hooks; do not add class components.
- Prefer Tailwind utilities and the existing `cn()` helper.
- Use CVA for reusable component variants.
- Keep reusable shadcn-style primitives in `src/components/ui/`.
- Maintain semantic HTML, keyboard access, visible focus states, labels, and `aria-*` attributes where required.
- Support mobile and desktop layouts; do not treat responsive behavior as optional.
- Respect `prefers-reduced-motion` for non-essential animation.
- Never expose credentials, tokens, password hashes, or fixture secrets in UI or logs.

## Verification

After code changes, run the checks relevant to the change:

```bash
pnpm --filter demo build
pnpm --filter demo lint
```

For user-facing flows, use Prism's authorized `prism_browser` current-tab tools when real browser verification is requested. Verify the changed flow at mobile and desktop widths when layout behavior is affected.

