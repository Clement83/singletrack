---
name: ui-ux
description: singletrack UI/UX best practices (interactions, accessibility, forms, touch, mobile first, French typography) — Vercel Web Interface Guidelines adapted to the project's charter. Load it BEFORE writing or changing any component, page or style (src/app, src/components, globals.css), and for a UI audit ("review the UI", "UX audit", "accessibility").
---

# UI/UX — singletrack

The **interface charter** and the **mobile rules** of `AGENTS.md` are authoritative (simple, calm, mobile first, the map as the star, design-system tokens and components #1363). This skill adds the execution rules that are often missing: a screen can follow the charter and still be painful to use (no pointer cursor, invisible focus, no numeric keyboard, double tap that zooms…).

Based on the [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (MIT, © Vercel Labs), adapted to French copy, Tailwind 4 and shadcn/ui. Rules marked **(ST)** are specific to singletrack.

## Before coding

1. Read the charter in `AGENTS.md` and `design/README.md`. Reuse `src/components/ui/*` (`Button`, `Field`, `Badge`, `BottomSheet`, `EmptyState`, `Skeleton`, `Toaster`): never rebuild a button or a field by hand.
2. One main action per screen (`Button size="lg"`, full width, at the bottom on mobile).
3. Plan the 4 states from the start: loading (skeleton), empty (informal tone + action), error (what happened + what to do), long content.

## Interactions and cursor

- Every clickable element has `cursor: pointer` — **(ST)** set globally in `globals.css` (`@layer base`) because Tailwind 4 no longer sets it on `<button>`. A clickable element that is neither `<button>`, `<a>` nor `role="button"` is a bug (see Semantics), not a case for `cursor-pointer`.
- Disabled: `disabled` (button) or `aria-disabled="true"` (+ global `not-allowed` cursor), reduced opacity, no hover.
- Every button/link has a `hover:` **and** an `active:` state (mobile has no hover: `active:` is the touch feedback). Interactive states increase contrast, never the opposite.
- **Never an action on hover alone** (charter); a tooltip never carries essential information.
- Touch targets ≥ 44 px (`min-h-touch`, `size-touch`), at least 8 px apart.
- `touch-action: manipulation` on interactive elements (set globally); `-webkit-tap-highlight-color` transparent (set) ⇒ visual feedback comes from `active:`.
- Submit button: enabled until the request starts, then disabled + spinner + "Saving…" label. No double submit.
- Destructive action (delete, revoke a link, cancel an outing): confirmation or undo (toast "Undo") — never immediate and final.
- Gesture (drag, pinch, swipe): always an alternative by tap and keyboard.
- `autoFocus`: never on mobile (opens the keyboard and hides the screen); desktop only, a single main field.

## Focus and keyboard

- Visible focus everywhere: global `:focus-visible` (`--ring` ring). Never `outline-none` without a `focus-visible:ring-*` replacement.
- `:focus-visible` rather than `:focus`; `:focus-within` for composite controls.
- Tab order = visual order; a `BottomSheet`/dialog traps focus and gives it back on close (Radix/vaul do it: do not break it).
- The bottom bar, sticky headers and sheets do not cover the focused element (`scroll-margin`/`scroll-padding`).

## Semantics and accessibility

- `<button>` for an action, `<a>`/`<Link>` for navigation (middle click, Ctrl+click). Never `<div onClick>`.
- Icon-only button: `aria-label` through the translations ("Me localiser" / "Locate me", "Fermer" / "Close"). Decorative icon: `aria-hidden="true"` (lucide).
- Every field has a clickable `<label>` (`htmlFor`) — `Field` does it.
- Asynchronous messages (toasts, validation, submit result): `aria-live="polite"` (sonner does it).
- Hierarchical headings `h1` → `h2`…; a single `h1` per page.
- Images: `alt` (or `alt=""` if decorative), explicit `width`/`height`.
- AA contrast (text 4.5, UI 3) **in light and dark**: `npm run tokens:check`.
- Colour never carries information alone (difficulty, fire, slope): a label or a legend next to it.

## Forms (mobile)

- Right `type` and `inputmode`: `email`, `tel`, `inputMode="numeric"` (codes, km, elevation), native `type="date"`/`time`.
- Relevant `autoComplete` (`email`, `one-time-code`, `name`) and an explicit `name`; `autoComplete="off"` on fields unrelated to identity.
- `spellCheck={false}` on email, codes, identifiers. Never block pasting.
- Errors under the field concerned, in plain words, with the fix; focus on the first error on submit.
- Placeholder = an example, ending with `…` (« ex. Col du Fenouillet… »); never instead of the label.
- Warn before leaving with unsaved changes (track editor, outing forms).
- Short forms: ask for the minimum, smart defaults.

## Mobile-first layout

- Design at 375 px, then widen (`md:`, `lg:`). No horizontal scroll (`min-w-0` on flex children, `truncate`/`line-clamp`/`break-words` on text).
- Full screen: `env(safe-area-inset-*)` (notch, gesture bar) — bottom bar, sheet, buttons pinned at the bottom.
- `overscroll-behavior: contain` in sheets, dialogs and scrolling lists.
- Layout with flex/grid, never with JS measurements.
- No `user-scalable=no` or `maximum-scale=1`: zoom stays possible.
- **(ST)** Full-screen or embedded map: follow the "Mobile rules" of `AGENTS.md` (`BaseMap`, `LazyMap embedded`, `.map-touch`).

## Animation

- ≤ 200 ms, restrained (charter). `prefers-reduced-motion` respected (global switch-off in `globals.css`).
- Animate `transform`/`opacity` only; never `transition: all` (`transition-colors`, `transition-[transform,opacity]`).
- Animations can be interrupted by the user.

## Typography and copy (French) — (ST)

These rules apply to the **French UI copy** (`messages/fr.json`); English copy follows English conventions.

- Simple, **informal (tutoiement)** tone, active voice, precise action verbs: « Créer la sortie », not « Valider » or « OK ».
- **No Title Case** (an English rule from Vercel's guidelines): capital on the first word only.
- French punctuation: guillemets « », non-breaking space (` `) before `: ; ! ?` and between number and unit (`12 km`, `350 m`), `…` and not `...`, typographic apostrophe `’` in displayed text.
- Digits for quantities (« 3 invités »), `font-variant-numeric: tabular-nums` (`tabular-nums`) for stats and columns of numbers.
- Dates, times, numbers: `Intl.DateTimeFormat`/`Intl.NumberFormat` in `fr-FR`, `Europe/Paris` time zone; watch for server/client hydration mismatches on dates.
- Headings: `text-balance`; paragraphs: `text-pretty`.
- Error messages: what happened + what to do (« Pas de réseau — on réessaie dès que tu es de retour »).

## Theme

- Colours **only** through tokens (`bg-primary`, `text-muted-foreground`…): never a hard-coded colour (lint + tests).
- Check every screen in light and dark; native `<select>`s readable in dark (explicit background and colour).
- `theme-color` consistent with the background.

## Perceived performance

- Skeletons rather than full-screen spinners; no layout shift (reserved dimensions).
- Lists > 50 items: virtualise or `content-visibility: auto`.
- No layout reads (`getBoundingClientRect`…) during render.
- See also the `react-performance` skill for React/Next.

## Screen audit (end-of-ticket UI checklist)

For every file touched, check the rules above and report deviations as `file:line - problem`, grouped by file (`✓ ok` if none). Then, in the rebuilt app:

1. 375 px and desktop, light and dark (screenshots required by the charter).
2. Everything with the **keyboard** alone: Tab, Enter, Escape, focus always visible.
3. Pointer cursor on everything clickable, `active:` state under the finger.
4. Empty / loading / error / very long text states.
5. Lighthouse accessibility (see `AGENTS.md`).

A deviation found outside the ticket's scope becomes a ticket; it is not fixed on the side.
