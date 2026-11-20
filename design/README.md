# singletrack design system

Mountain-bike rides with friends: **clean, calm, and designed for the phone you pull out of your pocket at the car park.**
This guide applies the **interface charter** of `AGENTS.md` (which is authoritative). Living visual reference: **`/styleguide`** (`http://192.0.2.10:3700/styleguide`).

## How it works

```
design/tokens.json  ──npm run tokens──▶  src/app/styles/tokens.css  ──▶  Tailwind (bg-primary, text-small, rounded-lg…)
   (single source)                        (GENERATED, never edited)       shadcn/ui (--background, --primary, --ring…)
```

- **`design/tokens.json`**: themes, colours (value per theme + usage note), contrast pairs to check, font, type scale, radii, shadows, sizes, durations, map settings.
- **`npm run tokens`** generates `src/app/styles/tokens.css`: one block per theme (`:root` / `[data-theme='…']`), the JS-free `@media (prefers-color-scheme: dark)` fallback, then the Tailwind 4 wiring (`@theme`). Tailwind's default palette is **disabled**: `bg-red-500` does not exist.
- Running it (throwaway container, mounted folder, like `npm install`):
  ```bash
  docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app node:22-slim npm run tokens
  docker compose -f docker-compose.yml exec app-dev npm run tokens:check   # up to date? + report of every contrast
  ```

### Changing the look

- **Change a colour**: change its value in `tokens.json`, `npm run tokens`, rebuild. The whole app follows, no component to touch.
- **Add a theme**: add an entry to `themes` (`id`, `name`, `scheme`, optionally `extends`) and its values in `color[].value.<id>`. With `extends: "light"`, only what changes is declared. The theme shows up on its own in the switcher (`ThemeSwitcher`).
- **Only two themes** (#1396): **light** (near-white neutrals, white cards, ink text, indigo accent `#4f46e5`) and **dark** (deep neutrals `#0b0c0e` / `#141518`, text `#ececee`, light indigo `#a5a6ff` with dark text) — Singletrack charter (#1645). The `extends` mechanism stays available for a future theme.
- Light / dark / system theme: `next-themes` (`data-theme` attribute), choice remembered in the browser.

### Charters (#1624)

A second axis, **independent of light/dark**: the *charter* (`chartes` in `tokens.json`) carries radii, fonts, shadows, colours and glass surfaces. The base charter (**Singletrack**, #1645, id `classique` kept for existing accounts) sits on `:root`. Another charter only declares what changes: `"chartes": { "<id>": value }` on a token (plain value, or `{light, dark}` for colours and shadows; type: partial fields), `extends` to inherit from another charter.

- Generation: `[data-charte='x'][data-theme='light|dark']` (and the JS-free `prefers-color-scheme` fallback), only the variables that differ from the base charter. Tailwind already reads `--radius-*`, `--font-*`, `--text-*`, `--elevation-*`: no component knows about the charter.
- New tokens: `surface-glass` (+ `-foreground`), `glass-opacity`, `glass-blur` (`backdrop-filter` value: `none` or `blur(16px)`), `border-width` (variable only), `display` and `mono` fonts.
- **`glass`** utility (`globals.css`): `surface-glass` background at `glass-opacity` + `glass-blur`, opaque fallback without `backdrop-filter` or under `prefers-reduced-transparency`. **Since #1689 `glass` is reserved for the mobile `BottomSheet` (and its fixed footer) and the fixed bars** (nav bar, outing bar, toasts); everything else that floats over the map uses `floating`. Singletrack: 72 % (dark 70 %) + `saturate(180%) blur(20px)`.
- **`floating`** utility (#1689, "floating surfaces"): the single recipe for what floats over the map — desktop panel, map buttons (one pill in a right-hand column, hairline separators, ≥ 44 px), search and filters, legends, menus, tooltips: `surface-glass` at `floating-opacity` (94 %) + `floating-blur` (`blur(8px)`), 1 px hairline, `elevation-floating` (two-layer shadow); opaque under `prefers-reduced-transparency`. Radius 12 px (`rounded-2xl`), pill for search. Never a hard-coded colour or shadow. The map's padding follows the open panel (`floatingPadding`, `src/lib/tracks/map-view.ts`): desktop = rail + panel + gap on the left, mobile = sheet height at the current detent; fits add only their own margins.
- Contrasts checked for every charter × theme (text on glass against the opaque fallback).
- **A single charter today (#1646)**: the Technique nuit, Affiche de trail and Alpin verre experiments (#1626 to #1628) are removed (tokens, CSS, fonts). The mechanism stays for future charters; as long as there is only one, `CharteSwitcher` is not shown (user menu, `/styleguide`). An account whose `user.charte` is unknown falls back to `classique`, without error (`getCharte`).

### Guard rails (green in the container, `npm test` and `npm run lint`)

- **WCAG contrasts** (`tests/tokens.test.ts`): every `contrast` pair is checked in **every** theme — 4.5:1 for text, 3:1 for field outlines, focus and dots. `fire-2` (official yellow) is exempt: the dot is always outlined + labelled.
- **`tokens.css` up to date**: the test fails if someone changed `tokens.json` without regenerating (or edited the generated file).
- **No hard-coded colour** (ESLint, `src/**`): hex values, `rgb()`/`hsl()`/`oklch()`…, `bg-[#…]` and Tailwind palette colours are forbidden. Also checked in `.css` files (except `tokens.css`). Only exception: `style={{ background: 'var(--token)' }}`.
- For MapLibre (which does not read CSS variables): read the value at runtime, `getComputedStyle(document.documentElement).getPropertyValue('--diff-red')`, and read it again when the theme changes. Map settings live in `--map-*`.

## Principles — Singletrack charter (#1645)

A direction inspired by the best around (Apple HIG for materials and type, Linear/Vercel/Stripe for density and details, Komoot/Strava/Maps for the map), without copying their identity:

1. **The map first.** It fills the screen; the interface floats on top of it, in **glass** (20 px blur + 180 % saturation, 72 % opacity) — nav bar, sheet, map buttons, menus, toasts. **Never glass on a content card**; opaque fallback under `prefers-reduced-transparency` or without `backdrop-filter`.
2. **Neutrals first, a single accent.** Near-white / near-black greys, ink text; indigo (`primary`) is only for the main action, selection, links and focus. Domain colours (difficulty, fire, slopes, answers) keep their meaning.
3. **Hairlines rather than fills.** Low-contrast 1 px outlines (`border`) to separate; fields keep an outline ≥ 3:1 (`input`).
4. **Layered depth.** Soft 2–3 layer shadows (contact + diffusion); in dark mode, a light 1 px highlight at the top of surfaces replaces the shadow you can no longer see.
5. **Tight, ranked radii**: 4 px (checkboxes) · 8 px (buttons, fields) · 12 px (cards, panels) · 16 px (sheet, dialogs). Nested = **concentric** (parent radius − inset, `concentric` utility).
6. **Tight type**: headings slightly tightened (negative letter-spacing), body at −0.011 em, labels in spaced capitals; **tabular** figures wherever values are compared (stats, profiles).
7. **"Product" density** on a 4 px grid, never shrinking touch targets (≥ 44 px).
8. **Short, physical motion**: 120 ms for state feedback, 200 ms for an opening, a crisp `ease-out`; a slight spring (`ease-spring`, ~3 %) on press (`press`). Everything is turned off under `prefers-reduced-motion`.
9. **Explicit states**: hover (desktop only), press, visible keyboard focus (2 px ring + 2 px offset), disabled at 50 %. Never an action on hover alone.
10. **Small details**: balanced headings (`text-wrap: balance`), paragraphs without widows (`pretty`), text selection tinted with the accent, Inter's tailed "l" to tell l / I / 1 apart.
11. **One main action per screen**, in `primary`, full width, at the bottom (`<Button size="lg">`). Everything else is secondary or ghost.
12. **Mobile first.** Design at 375 px, then widen (`lg:` = 1024 px).

## Colour

| Token | Usage |
|---|---|
| `background` / `foreground` | Near-white / near-black page, ink / light grey text |
| `card`, `popover` | Content cards, fields / menus, toasts (opaque glass fallback) |
| `muted` / `muted-foreground` | Recesses (skeletons, handle) / secondary text, attributions |
| `secondary` | Secondary buttons |
| `primary` / `primary-foreground` | The single accent (indigo): main action, active nav, links, focus (`ring`) |
| `accent` / `accent-foreground` | Soft pale-indigo selection (active filter, chosen answer) |
| `destructive`, `warning`, `success` (+ `-soft`) | States; always a word or an icon with the colour |
| `border` / `input` | Decorative hairlines / field outlines (≥ 3:1) |

**Domain scales, never without a label** (tables in `src/lib/design/scales.ts`, dedicated badges):
difficulty `diff-green` Easy · `diff-blue` Medium · `diff-red` Hard · `diff-black` Very hard;
massifs `fire-1`…`fire-5` (green → black, prefecture colours); answers `rsvp-yes` · `rsvp-maybe` · `rsvp-no`;
slopes `slope-up-1..5` (climb, blue → red) and `slope-down-1..5` (descent, turquoise → magenta), **reserved for the detail of a track**, mid-range values identical in light/dark because they read both on `card` and on the light map background (`map-base`, contrast reference only); classes in `src/lib/geo/slopes.ts`.
`diff-black` and `fire-5` invert in dark mode. Never text in a scale colour: the colour goes on a dot or a line.

## Typography

**Inter 4 variable with optical axis** (`@fontsource-variable/inter/opsz.css`, self-hosted, no CDN), system stack fallback.
Why: already proven on the interface and its French accents, the `opsz` axis gives the *Display* cut (tighter, thinner) for free on large headings and the *Text* cut on body copy; tabular figures and alternates (`cv05`) built in — Geist would have added a second family for a marginal gain.
Hierarchy through size, weight and tracking, not colour:

| Class | Size / line height | Weight | Tracking | Usage |
|---|---|---|---|---|
| `text-display` | 28 / 32 | 650 | −0.022 em | Sheet title, once per screen |
| `text-title` | 20 / 26 | 620 | −0.017 em | Page title, sheet header |
| `text-heading` | 17 / 24 | 600 | −0.012 em | Block subheading |
| `text-body` | 16 / 24 | 400 | −0.011 em | Body text, fields (16 px: no iOS zoom) |
| `text-small` | 14 / 20 | 400 | −0.006 em | Meta, help |
| `text-label` | 12 / 16 | 560 | +0.04 em | Label in capitals (+ `uppercase`) |
| `text-caption` | 12 / 16 | 450 | 0 | Timestamps, axes |
| `text-stat` | 20 / 24 | 600 | −0.02 em | Stat values (tabular by default) |

`.text-stat` and `.tabular-nums` set `font-variant-numeric: tabular-nums`.
French-style figures through `src/lib/format.ts`: `32,1 km`, `662 m D+`, `3 h 30`, `dim. 15 nov. · 8 h 00` (non-breaking spaces).

## Space, shapes, motion

- **4 px** grid (Tailwind scale: `1` = 4 px). Gutter `px-gutter` (16 px) on mobile, `lg:px-gutter-lg` (32 px); between blocks of a sheet `gap-block` (24 px).
- Radii (ranked, `--radius-*`): `rounded-sm` 4 (dots, details) · `rounded-md` 6 (**controls**: buttons, fields, choice chips, badges) · `rounded-lg` 8 (list items, navigation) · `rounded-xl` 8 (toasts, thumbnails) · `rounded-2xl` 12 (**cards and panels**, sheet, menus) · `rounded-3xl` 16 (reserved for large surfaces) · `rounded-full` (avatars, dots, round map buttons only). Never a large radius on a control. Nested: `concentric` (`--radius-outer` − `--inset`, default 12 − 4).
- `ui/` components (#1646): controls at 6 px, `border-border` hairline or `ring-inset ring-border/60`, `font-medium` weight (no `font-semibold` on controls), 18 px icons with a 1.75 stroke, `press` on tap (never an action on hover alone), glass (`glass`) on floating layers only (nav, sheets, menus, toasts), never on content cards.
- Shadows: `shadow-sm` (content at rest), `shadow-md` (floating layers), `shadow-sheet`.
- Sizes: `h-button-lg` (52), `h-nav` (64), `w-rail` (80), `w-panel` (400).
- Durations `--duration-fast` 120 ms (default for transitions), `--duration-base` 200 ms, `--duration-slow` 320 ms (large movements); curves `ease-out` (default for transitions), `ease-in-out`, `ease-spring` (`easing` tokens). `press` utility: 0.97 press-in with a spring on tap.

## Tone and copy

The app's French copy is informal (**tutoiement**) with short sentences: « On roule dimanche ? », « Tu viens ? ». Buttons say what happens (**GO**, « Créer la sortie », « Copier le lien »). Empty states come with a next step: « Aucune sortie prévue — on en crée une ? ». Errors: what happened + what to do. No emoji in the interface. Attributions always visible in `text-small text-muted-foreground`. English copy follows the same spirit (short, friendly, action verbs).

## Components — use them, do not recreate them

| Component | File | Role |
|---|---|---|
| `Button` | `src/components/ui/button.tsx` | `primary` · `secondary` · `outline` · `ghost` · `destructive`; sizes `md` (44), `lg` (52, full width), `icon` (round 44); `asChild` for a link |
| `Badge`, `DifficultyBadge`, `FireBadge`, `RsvpBadge` | `src/components/ui/badge.tsx` | Pills; scale badges always carry their label |
| `Field`, `Input`, `Textarea`, `NativeSelect`, `Label` | `src/components/ui/field.tsx` | 16 px fields, ≥ 44 px, label + help/error linked (ARIA). Native selects |
| `BottomSheet` | `src/components/ui/bottom-sheet.tsx` | Details: 3-detent sheet (148 px / 50 % / 92 %, `vaul`, non-modal) on mobile, 400 px panel on desktop. `footer` = main action, always visible |
| `AppNav`, `BottomNavBar`, `SideNavBar` | `src/components/app-nav.tsx` | Map · Tracks · Outings; bottom bar (mobile), side bar (≥ 1024 px) |
| `RsvpPanel` | `src/components/rsvp-panel.tsx` | Guest answer: GO / Maybe / No, can be changed |
| `ConditionsBlock` | `src/components/conditions-block.tsx` | Weather · fire · hunting; "Not available yet" while the source is missing (#1349, #1350, #1354) |
| `OutingParticipants` | `src/components/outings/outing-participants.tsx` | "Who's coming" (#1468): stacked avatars, 3 first names "and n others", `ActionSheet` drawer grouped by answer; data through `listParticipants` |
| `TrackCard`, `TrackCardSkeleton` | `src/components/track-card.tsx` | Track or outing in a list |
| `EmptyState` | `src/components/ui/empty-state.tsx` | Empty or error state, with an action |
| `Skeleton` | `src/components/ui/skeleton.tsx` | Loading |
| `Toaster` + `toast()` from `sonner` | `src/components/ui/toaster.tsx` | Short confirmations ("Link copied"), mounted in the layout |
| `ThemeSwitcher` | `src/components/theme-switcher.tsx` | System / light / dark / themes from `tokens.json` |

Components follow shadcn/ui conventions (`cn()` in `src/lib/utils.ts`, `cva`, `data-slot`): a shadcn component added later reads the same variables directly.

## Iconography

**lucide** only, 1.75 stroke, 20 px in lists and buttons, 24 px in the nav and on the map, colour inherited from the text. Domain icons: `route` (distance), `mountain` (elevation gain), `calendar-days` (outing), `map` (map), `flame` (fire), `cloud-sun` (weather), `crosshair` (hunting), `users` (participants).
