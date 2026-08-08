# Prism Demo Design Specification

## 1. Design direction

Prism Demo uses a calm, editorial workspace aesthetic: warm neutral surfaces, near-black structure, restrained gold accents, generous whitespace, and clear content hierarchy. The interface should feel focused and considered rather than decorative or dashboard-heavy.

Design principles:

1. **Content first** — controls support the note or task instead of competing with it.
2. **Warm restraint** — use warm neutrals and gold sparingly; avoid saturated decorative color.
3. **Clear hierarchy** — typography, spacing, and surface depth should communicate priority before borders do.
4. **Quiet confidence** — motion and shadows are subtle, purposeful, and never playful for their own sake.
5. **Real usability** — every state must remain understandable, accessible, and responsive.

## 2. Color system

Use the existing CSS variables for shared shadcn primitives. For Demo-specific surfaces, use this palette consistently:

| Role | Color | Usage |
|---|---|---|
| Primary ink | `#24231f` | Main actions, headings, primary text |
| Deep ink | `#171717` / `#20201e` | Brand panels, logo tiles, high-contrast areas |
| App background | `#f4f3ef` | Global authenticated workspace background |
| Raised background | `#f8f7f3` | Header, sidebar, secondary surfaces |
| Reading surface | `#fffefa` | Notes, editors, primary content cards |
| Login background | `#f7f7f5` | Authentication workspace |
| Canvas surface | `#eeece6` | Area behind reading cards |
| Strong border | `#dedbd2` | Layout divisions |
| Soft border | `#e5e2da` / `#ece8de` | Internal separators |
| Accent | `#9a7b43` | Eyebrows, selected indicators, important links |
| Accent dark | `#80683e` | Interactive accent text and controls |
| Accent pale | `#f0ebdf` / `#eee8db` | Tags, icon backgrounds, soft hover states |
| Secondary text | `#77736b` / `#858178` | Supporting copy |
| Muted text | `#99958c` / `#aaa69d` | Metadata and placeholders |
| Destructive | Tailwind `red-600` | Errors and destructive feedback only |

Rules:

- Reserve gold for emphasis and interaction; it must not become a large background color.
- Use red only for errors or destructive actions.
- Do not introduce blue, purple, neon gradients, or unrelated brand colors without an explicit requirement.
- Body text and interactive text must maintain WCAG AA contrast against their surfaces.

## 3. Typography

- Primary family: `Inter`, followed by the system sans-serif stack defined in `src/index.css`.
- Page or feature title: `text-3xl` to `text-4xl`, weight 600, slightly negative tracking.
- Section title: `text-xl` to `text-2xl`, weight 600.
- Card/list title: `text-sm` to `text-base`, weight 600.
- Body: `text-sm` to `text-base`; long-form content uses relaxed line height (`leading-7` or `leading-8`).
- Metadata: `text-[10px]` to `text-xs`, muted color.
- Eyebrow: uppercase, `text-xs`, medium weight, tracking around `0.18em`, accent color.

Avoid excessive bold text. Use size, spacing, and muted color before adding more font weight.

## 4. Spacing and layout

- Use a 4px base rhythm through Tailwind's spacing scale.
- Related controls: 8–12px apart.
- Form fields and list items: 16–20px vertical rhythm.
- Card padding: 24px mobile, 32–56px desktop depending on content density.
- Section separation: 32–48px.
- Long-form reading width: no more than approximately `1080px`; form width: approximately `430px`.

Primary layouts:

- Authentication: split editorial brand panel and form on large screens; form-only layout on small screens.
- Workspace: 64px sticky header, fixed-width list sidebar on desktop, full-width overlay/list mode on mobile, flexible reading canvas.
- Modals/editors: bottom sheet on mobile and centered dialog on larger screens.

Do not compress desktop layouts into narrow mobile columns without explicitly adapting navigation and actions.

## 5. Shape, borders, and elevation

- Small controls: `rounded-lg`.
- Inputs, buttons, list items, tags with presence: `rounded-xl`.
- Primary cards: `rounded-2xl`.
- Dialogs: `rounded-3xl` on desktop; `rounded-t-3xl` for mobile sheets.
- Prefer soft warm-gray borders over dark outlines.
- Use shadows only to distinguish selected content, floating dialogs, or the primary reading surface.
- Shadows must be broad and low-opacity; avoid sharp black drop shadows.

## 6. Components and interaction

### Buttons

- Primary buttons use near-black backgrounds with white text.
- Secondary buttons use an outline or quiet neutral surface.
- Text actions may use the dark gold accent and underline on hover.
- Icon-only buttons require an accessible name.
- Loading buttons keep their width stable and show a spinner plus clear progress text.

### Forms

- Inputs are normally 40–48px high, white, `rounded-xl`, and low-shadow.
- Every field has a visible label; placeholders never replace labels.
- Errors appear adjacent to the relevant field, with a form-level alert for server errors.
- Use appropriate `type`, `autoComplete`, and `aria-invalid` attributes.
- Disable submission only when the reason is visually understandable.

### Lists and cards

- Selected list items use a white surface, subtle ring, and soft shadow.
- Hover states use low-opacity ink rather than a new color.
- Metadata stays visually subordinate to titles and content previews.
- Empty and loading states occupy the content region and explain what is happening.

### Feedback

- Loading, success, empty, validation, server-error, and disabled states are required where applicable.
- Avoid relying on color alone; pair status color with text or an icon.
- Destructive actions require explicit wording and confirmation when data loss is material.

## 7. Motion

- Default entrance motion: short fade with approximately 14px upward movement.
- Recommended duration: 180–560ms depending on scale; use ease-out curves.
- Hover motion should be small, such as a subtle arrow translation.
- Do not animate routine text changes, validation errors, or large layout shifts.
- Disable non-essential motion under `prefers-reduced-motion: reduce`.

## 8. Responsive behavior

- Mobile-first minimum supported width: 320px.
- Preserve 44px minimum touch targets for important actions.
- Hide the editorial authentication panel below `lg` while retaining compact branding.
- Convert the workspace sidebar into an explicit mobile list/navigation layer.
- Dialog forms become bottom sheets on small screens.
- Prevent horizontal scrolling in forms, cards, and action rows.
- Long titles and user-generated content must wrap or truncate intentionally.

## 9. Accessibility

- Use landmarks (`header`, `main`, `aside`, `section`, `article`) according to content structure.
- Maintain logical heading order.
- All functionality must be operable with a keyboard.
- Focus indicators must remain visible; do not remove outlines without an equivalent focus ring.
- Associate labels and errors with form controls.
- Use `role="alert"` for actionable asynchronous or validation failures.
- Decorative icons should not become the only source of meaning.

## 10. Definition of done for UI work

A user-facing change is complete only when:

- It follows this palette, typography, spacing, radius, and elevation language.
- Default, hover, focus, loading, empty, error, and disabled states relevant to the feature are handled.
- It works at mobile and desktop widths without overflow.
- It is keyboard accessible and uses meaningful labels.
- Existing business behavior is preserved unless intentionally changed.
- The Demo build and lint checks pass.

