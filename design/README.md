# Design system singletrack

Sorties VTT entre potes : **net, calme, et pensé pour le téléphone qu'on sort de la poche au parking.**
Ce guide applique la **charte d'interface** de `AGENTS.md` (elle fait foi). Référence visuelle vivante : **`/styleguide`** (`http://192.0.2.10:3700/styleguide`).

## Comment ça marche

```
design/tokens.json  ──npm run tokens──▶  src/app/styles/tokens.css  ──▶  Tailwind (bg-primary, text-small, rounded-lg…)
   (source unique)                        (GÉNÉRÉ, jamais édité)          shadcn/ui (--background, --primary, --ring…)
```

- **`design/tokens.json`** : thèmes, couleurs (valeur par thème + note d'usage), couples de contraste à vérifier, police, échelle typo, rayons, ombres, tailles, durées, réglages carte.
- **`npm run tokens`** génère `src/app/styles/tokens.css` : un bloc par thème (`:root` / `[data-theme='…']`), le repli `@media (prefers-color-scheme: dark)` sans JS, puis le branchement Tailwind 4 (`@theme`). La palette Tailwind par défaut est **désactivée** : `bg-red-500` n'existe pas.
- Lancement (conteneur jetable, dossier monté, comme `npm install`) :
  ```bash
  docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app node:22-slim npm run tokens
  docker compose exec app npm run tokens:check   # à jour ? + rapport de tous les contrastes
  ```

### Changer de look

- **Modifier une couleur** : changer sa valeur dans `tokens.json`, `npm run tokens`, rebuild. Toute l'appli suit, aucun composant à toucher.
- **Ajouter un thème** : ajouter une entrée dans `themes` (`id`, `name`, `scheme`, éventuellement `extends`) et ses valeurs dans `color[].value.<id>`. Avec `extends: "light"`, on ne déclare que ce qui change. Le thème apparaît tout seul dans le sélecteur (`ThemeSwitcher`).
- **Deux thèmes seulement** (#1396) : **clair** (neutres presque blancs, cartes blanches, texte encre, accent indigo `#4f46e5`) et **sombre** (neutres profonds `#0b0c0e` / `#141518`, texte `#ececee`, indigo clair `#a5a6ff` avec texte foncé) — charte Singletrack (#1645). Le mécanisme `extends` reste disponible pour un futur thème.
- Thème clair / sombre / système : `next-themes` (attribut `data-theme`), choix mémorisé dans le navigateur.

### Chartes (#1624)

Un second axe, **indépendant du clair/sombre** : la *charte* (`chartes` dans `tokens.json`) porte rayons, polices, ombres, couleurs et surfaces verre. La charte de base (**Singletrack**, #1645, id `classique` conservé pour les comptes existants) est sur `:root`. Une autre charte ne déclare que ce qui change : `"chartes": { "<id>": valeur }` sur un token (valeur simple, ou `{light, dark}` pour couleurs et ombres ; texte : champs partiels), `extends` pour hériter d'une autre charte.

- Génération : `[data-charte='x'][data-theme='light|dark']` (et repli `prefers-color-scheme` sans JS), uniquement les variables qui diffèrent de la charte de base. Tailwind lit déjà `--radius-*`, `--font-*`, `--text-*`, `--elevation-*` : aucun composant ne connaît la charte.
- Nouveaux tokens : `surface-glass` (+ `-foreground`), `glass-opacity`, `glass-blur` (valeur de `backdrop-filter` : `none` ou `blur(16px)`), `border-width` (variable seule), polices `display` et `mono`.
- Utilitaire **`glass`** (`globals.css`) : fond `surface-glass` à `glass-opacity` + `glass-blur`, repli opaque sans `backdrop-filter` ou sous `prefers-reduced-transparency`. Posé sur la barre de navigation, le `BottomSheet`, les boutons de carte et les toasts. Singletrack : 72 % (sombre 70 %) + `saturate(180%) blur(20px)`.
- Contrastes vérifiés pour chaque charte × thème (texte sur verre contre le repli opaque).
- **Une seule charte aujourd'hui (#1646)** : les essais Technique nuit, Affiche de trail et Alpin verre (#1626 à #1628) sont retirés (tokens, CSS, polices). Le mécanisme reste pour de futures chartes ; tant qu'il n'y en a qu'une, `CharteSwitcher` ne s'affiche pas (menu utilisateur, `/styleguide`). Un compte dont `user.charte` est inconnue retombe sur `classique`, sans erreur (`getCharte`).

### Garde-fous (verts dans le conteneur, `npm test` et `npm run lint`)

- **Contrastes WCAG** (`tests/tokens.test.ts`) : chaque couple de `contrast` est vérifié dans **chaque** thème — 4,5:1 pour le texte, 3:1 pour contours de champs, focus et pastilles. `fire-2` (jaune officiel) est exempté : pastille toujours cerclée + libellé.
- **`tokens.css` à jour** : le test échoue si quelqu'un a modifié `tokens.json` sans régénérer (ou édité le fichier généré).
- **Anti-couleur en dur** (ESLint, `src/**`) : interdits les hex, `rgb()`/`hsl()`/`oklch()`…, `bg-[#…]` et les couleurs de la palette Tailwind. Aussi vérifié dans les `.css` (hors `tokens.css`). Seule exception : `style={{ background: 'var(--token)' }}`.
- Pour MapLibre (qui ne lit pas les variables CSS) : lire la valeur au runtime, `getComputedStyle(document.documentElement).getPropertyValue('--diff-red')`, et relire au changement de thème. Les réglages de la carte sont dans `--map-*`.

## Principes — charte Singletrack (#1645)

Direction inspirée de ce qui se fait de mieux (Apple HIG pour les matériaux et la typo, Linear/Vercel/Stripe pour la densité et les détails, Komoot/Strava/Plans pour la carte), sans en copier l'identité :

1. **La carte d'abord.** Elle occupe l'écran ; l'interface flotte par-dessus, en **verre** (flou 20 px + saturation 180 %, 72 % d'opacité) — barre de nav, sheet, boutons de carte, menus, toasts. **Jamais de verre sur une carte de contenu** ; repli opaque sous `prefers-reduced-transparency` ou sans `backdrop-filter`.
2. **Neutres d'abord, un seul accent.** Gris presque blancs / presque noirs, texte encre ; l'indigo (`primary`) ne sert qu'à l'action principale, la sélection, les liens et le focus. Les couleurs métier (difficulté, incendie, pentes, réponses) gardent leur sens.
3. **Hairlines plutôt qu'aplats.** Contours 1 px à faible contraste (`border`) pour séparer ; les champs gardent un contour ≥ 3:1 (`input`).
4. **Profondeur en couches.** Ombres douces à 2–3 couches (contact + diffusion) ; en sombre, un reflet clair de 1 px en haut des surfaces remplace l'ombre qu'on ne voit plus.
5. **Rayons serrés et hiérarchisés** : 4 px (cases) · 8 px (boutons, champs) · 12 px (cartes, panneaux) · 16 px (sheet, dialogues). Imbriqué = **concentrique** (rayon du parent − marge, utilitaire `concentric`).
6. **Typo resserrée** : titres légèrement serrés (letter-spacing négatif), corps à −0,011 em, étiquettes en capitales espacées ; chiffres **tabulaires** partout où on compare (stats, profils).
7. **Densité « produit »** sur une grille de 4 px, sans jamais rogner les zones tactiles (≥ 44 px).
8. **Mouvement court et physique** : 120 ms pour un retour d'état, 200 ms pour une ouverture, `ease-out` franc ; ressort léger (`ease-spring`, ~3 %) à l'appui (`press`). Tout est coupé sous `prefers-reduced-motion`.
9. **États explicites** : survol (desktop seulement), appui, focus clavier visible (anneau 2 px + 2 px d'écart), désactivé à 50 %. Jamais d'action au seul survol.
10. **Petits détails** : titres équilibrés (`text-wrap: balance`), paragraphes sans veuve (`pretty`), sélection de texte teintée d'accent, « l » à queue d'Inter pour distinguer l / I / 1.
11. **Une action principale par écran**, en `primary`, pleine largeur, en bas (`<Button size="lg">`). Le reste est secondaire ou fantôme.
12. **Mobile first.** On dessine à 375 px puis on élargit (`lg:` = 1024 px).

## Couleur

| Token | Usage |
|---|---|
| `background` / `foreground` | Page gris presque blanc / presque noir, texte encre / gris clair |
| `card`, `popover` | Cartes de contenu, champs / menus, toasts (repli opaque du verre) |
| `muted` / `muted-foreground` | Creux (squelettes, poignée) / texte secondaire, attributions |
| `secondary` | Boutons secondaires |
| `primary` / `primary-foreground` | Le seul accent (indigo) : action principale, nav active, liens, focus (`ring`) |
| `accent` / `accent-foreground` | Sélection douce indigo pâle (filtre actif, réponse choisie) |
| `destructive`, `warning`, `success` (+ `-soft`) | États ; toujours un mot ou une icône avec la couleur |
| `border` / `input` | Hairlines décoratives / contour des champs (≥ 3:1) |

**Échelles métier, jamais sans libellé** (tables dans `src/lib/design/scales.ts`, badges dédiés) :
difficulté `diff-green` Facile · `diff-blue` Moyen · `diff-red` Difficile · `diff-black` Très difficile ;
massifs `fire-1`…`fire-5` (vert → noir, couleurs préfectorales) ; réponses `rsvp-yes` · `rsvp-maybe` · `rsvp-no`.
pentes `slope-up-1..5` (montée bleu → rouge) et `slope-down-1..5` (descente turquoise → magenta), **réservées au détail d'une trace**, valeurs de milieu de gamme identiques en clair/sombre car lisibles à la fois sur `card` et sur le fond clair de la carte (`map-base`, référence de contraste uniquement) ; classes dans `src/lib/geo/slopes.ts`.
`diff-black` et `fire-5` s'inversent en sombre. Jamais de texte en couleur d'échelle : la couleur va sur une pastille ou un tracé.

## Typographie

**Inter 4 variable avec axe optique** (`@fontsource-variable/inter/opsz.css`, auto-hébergée, aucun CDN), repli pile système.
Pourquoi : déjà éprouvée sur l'interface et ses accents français, l'axe `opsz` donne gratuitement la coupe *Display* (plus serrée, plus fine) sur les grands titres et la coupe *Text* sur le corps ; chiffres tabulaires et variantes (`cv05`) natives — Geist aurait apporté une deuxième famille pour un gain marginal.
Hiérarchie par taille, graisse et approche, pas par la couleur :

| Classe | Taille / interligne | Graisse | Approche | Usage |
|---|---|---|---|---|
| `text-display` | 28 / 32 | 650 | −0,022 em | Titre de fiche, une fois par écran |
| `text-title` | 20 / 26 | 620 | −0,017 em | Titre de page, en-tête du sheet |
| `text-heading` | 17 / 24 | 600 | −0,012 em | Intertitre de bloc |
| `text-body` | 16 / 24 | 400 | −0,011 em | Texte courant, champs (16 px : pas de zoom iOS) |
| `text-small` | 14 / 20 | 400 | −0,006 em | Méta, aide |
| `text-label` | 12 / 16 | 560 | +0,04 em | Étiquette en capitales (+ `uppercase`) |
| `text-caption` | 12 / 16 | 450 | 0 | Horodatages, axes |
| `text-stat` | 20 / 24 | 600 | −0,02 em | Valeurs de stats (tabulaires d'office) |

`.text-stat` et `.tabular-nums` posent `font-variant-numeric: tabular-nums`.
Chiffres à la française via `src/lib/format.ts` : `32,1 km`, `662 m D+`, `3 h 30`, `dim. 15 nov. · 8 h 00` (espaces insécables).

## Espace, formes, mouvement

- Grille de **4 px** (échelle Tailwind : `1` = 4 px). Gouttière `px-gutter` (16 px) sur mobile, `lg:px-gutter-lg` (32 px) ; entre blocs d'une fiche `gap-block` (24 px).
- Rayons (hiérarchisés, `--radius-*`) : `rounded-sm` 4 (puces, détails) · `rounded-md` 6 (**contrôles** : boutons, champs, pastilles de choix, badges) · `rounded-lg` 8 (éléments de liste, navigation) · `rounded-xl` 8 (toasts, vignettes) · `rounded-2xl` 12 (**cartes et panneaux**, sheet, menus) · `rounded-3xl` 16 (réservé aux grandes surfaces) · `rounded-full` (avatars, points, boutons de carte ronds seulement). Jamais de grand rayon sur un contrôle. Imbriqué : `concentric` (`--radius-outer` − `--inset`, défaut 12 − 4).
- Composants `ui/` (#1646) : contrôles à 6 px, hairline `border-border` ou `ring-inset ring-border/60`, graisse `font-medium` (pas de `font-semibold` sur les contrôles), icônes 18 px au trait 1,75, appui `press` (jamais d'action au seul survol), verre (`glass`) sur les couches flottantes seulement (nav, sheets, menus, toasts), jamais sur les cartes de contenu.
- Ombres : `shadow-sm` (contenu au repos), `shadow-md` (couches flottantes), `shadow-sheet`.
- Tailles : `h-button-lg` (52), `h-nav` (64), `w-rail` (80), `w-panel` (400).
- Durées `--duration-fast` 120 ms (défaut des transitions), `--duration-base` 200 ms, `--duration-slow` 320 ms (grands déplacements) ; courbes `ease-out` (défaut des transitions), `ease-in-out`, `ease-spring` (tokens `easing`). Utilitaire `press` : enfoncement 0,97 en ressort à l'appui.

## Ton et textes

Français, **tutoiement**, phrases courtes : « On roule dimanche ? », « Tu viens ? ». Les boutons disent ce qui se passe (**GO**, « Créer la sortie », « Copier le lien »). États vides avec une suite : « Aucune sortie prévue — on en crée une ? ». Erreurs : ce qui s'est passé + quoi faire. Pas d'emoji dans l'interface. Attributions toujours visibles en `text-small text-muted-foreground`.

## Composants — à utiliser, pas à recréer

| Composant | Fichier | Rôle |
|---|---|---|
| `Button` | `src/components/ui/button.tsx` | `primary` · `secondary` · `outline` · `ghost` · `destructive` ; tailles `md` (44), `lg` (52, pleine largeur), `icon` (rond 44) ; `asChild` pour un lien |
| `Badge`, `DifficultyBadge`, `FireBadge`, `RsvpBadge` | `src/components/ui/badge.tsx` | Pilules ; les badges d'échelle portent toujours leur libellé |
| `Field`, `Input`, `Textarea`, `NativeSelect`, `Label` | `src/components/ui/field.tsx` | Champs 16 px, ≥ 44 px, libellé + aide/erreur reliés (ARIA). Sélecteurs natifs |
| `BottomSheet` | `src/components/ui/bottom-sheet.tsx` | Détails : sheet 3 crans (148 px / 50 % / 92 %, `vaul`, non modal) sur mobile, panneau 400 px en desktop. `footer` = action principale toujours visible |
| `AppNav`, `BottomNavBar`, `SideNavBar` | `src/components/app-nav.tsx` | Carte · Traces · Sorties ; barre du bas (mobile), barre latérale (≥ 1024 px) |
| `RsvpPanel` | `src/components/rsvp-panel.tsx` | Réponse de l'invité : GO / Peut-être / Non, modifiable |
| `ConditionsBlock` | `src/components/conditions-block.tsx` | Météo · incendie · chasse ; « Pas encore disponible » tant que la source manque (#1349, #1350, #1354) |
| `OutingParticipants` | `src/components/outings/outing-participants.tsx` | « Qui vient » (#1468) : avatars empilés, 3 prénoms « et n autres », tiroir `ActionSheet` groupé par réponse ; données via `listParticipants` |
| `TrackCard`, `TrackCardSkeleton` | `src/components/track-card.tsx` | Trace ou sortie dans une liste |
| `EmptyState` | `src/components/ui/empty-state.tsx` | État vide ou erreur, avec action |
| `Skeleton` | `src/components/ui/skeleton.tsx` | Chargement |
| `Toaster` + `toast()` de `sonner` | `src/components/ui/toaster.tsx` | Confirmations courtes (« Lien copié »), posé dans le layout |
| `ThemeSwitcher` | `src/components/theme-switcher.tsx` | Système / clair / sombre / thèmes de `tokens.json` |

Les composants suivent les conventions shadcn/ui (`cn()` dans `src/lib/utils.ts`, `cva`, `data-slot`) : un composant shadcn ajouté plus tard lit directement les mêmes variables.

## Iconographie

**lucide** uniquement, trait 1,75, 20 px dans les listes et boutons, 24 px dans la nav et sur la carte, couleur héritée du texte. Métier : `route` (distance), `mountain` (D+), `calendar-days` (sortie), `map` (carte), `flame` (incendie), `cloud-sun` (météo), `crosshair` (chasse), `users` (participants).
