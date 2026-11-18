# Design system singletrack

Sorties VTT entre potes : **simple, doux, et pensé pour le téléphone qu'on sort de la poche au parking.**
Ce guide applique la **charte d'interface** de `AGENTS.md` (elle fait foi). Référence visuelle vivante : **`/styleguide`** (`http://192.0.2.10:3700/styleguide`).

## Comment ça marche

```
design/tokens.json  ──npm run tokens──▶  src/app/styles/tokens.css  ──▶  Tailwind (bg-primary, text-small, rounded-2xl…)
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
- **Deux thèmes seulement** (#1396) : **clair** (sable chaud hérité de l'ancien thème « garrigue », texte ardoise de l'icône, action principale bleu nuit, accent abricot) et **sombre** (couleurs de l'icône : fond bleu nuit, panneaux ardoise, texte crème, action principale abricot du couchant). Le thème « garrigue » a été retiré ; le mécanisme `extends` reste disponible pour un futur thème.
- Thème clair / sombre / système : `next-themes` (attribut `data-theme`), choix mémorisé dans le navigateur.

### Chartes (#1624)

Un second axe, **indépendant du clair/sombre** : la *charte* (`chartes` dans `tokens.json`) porte rayons, polices, ombres, couleurs et surfaces verre. Classique = la charte actuelle, sur `:root`. Une autre charte ne déclare que ce qui change : `"chartes": { "<id>": valeur }` sur un token (valeur simple, ou `{light, dark}` pour couleurs et ombres ; texte : champs partiels), `extends` pour hériter d'une autre charte.

- Génération : `[data-charte='x'][data-theme='light|dark']` (et repli `prefers-color-scheme` sans JS), uniquement les variables qui diffèrent de Classique. Tailwind lit déjà `--radius-*`, `--font-*`, `--text-*`, `--elevation-*` : aucun composant ne connaît la charte.
- Nouveaux tokens : `surface-glass` (+ `-foreground`), `glass-opacity`, `glass-blur` (valeur de `backdrop-filter` : `none` ou `blur(16px)`), `border-width` (variable seule), polices `display` et `mono`.
- Utilitaire **`glass`** (`globals.css`) : fond `surface-glass` à `glass-opacity` + `glass-blur`, repli opaque sans `backdrop-filter` ou sous `prefers-reduced-transparency`. Posé sur la barre de navigation, le `BottomSheet`, les boutons de carte et les toasts. Classique = 100 % / `none` : surfaces pleines.
- Contrastes vérifiés pour chaque charte × thème (texte sur verre contre le repli opaque).
- **Technique nuit (#1626, `nuit`)** : sombre d'abord (fond `#0b0f14`, panneaux `#121821`, primaire vert fluo `#c6f432` avec texte foncé) ; en clair, gris froid et vert olive (`#3d6b00`) pour que texte, liens et focus passent AA. Rayons 2–8 px, ombres plus denses, verre sombre `72 %` (clair `78 %`) + `blur(16px)`. Polices auto-hébergées `@fontsource-variable/space-grotesk` (titres : `h1`–`h3`, `.text-display|title|heading`, token `display`) et `jetbrains-mono` (chiffres : `.text-stat`, `.tabular-nums`, token `figures`) ; Classique : `display` et `figures` = Inter, rien ne change. Les `@font-face` sont importés partout mais le navigateur ne télécharge un fichier que si la charte l'utilise.
- **Affiche de trail (#1627, `affiche`)** : clair d'abord, sable `#f2ede4`, texte noir, orange signalisation `#ff4f1a` en `accent` (sélection, texte noir dessus) ; l'action principale (`primary`, liens, nav) est un orange foncé `#c23600` en clair pour passer AA (l'orange vif ne passe pas sur sable). Contours `border-width` 2 px (`.border`, `.border-t`, `.border-b` sous `[data-charte='affiche']`), rayons 0–4 px, ombres décalées pleines (`4px 4px 0`), verre opaque (pas de flou). Sombre : fond brun-noir, contours crème, orange `#ff5a24`. Titres Anton en capitales (`@fontsource/anton/latin-400.css`, une seule graisse), corps Inter.
- `/styleguide` : `CharteSwitcher` (attribut `data-charte`, sans compte). Le choix par compte (#1625) est dans le menu utilisateur.

### Garde-fous (verts dans le conteneur, `npm test` et `npm run lint`)

- **Contrastes WCAG** (`tests/tokens.test.ts`) : chaque couple de `contrast` est vérifié dans **chaque** thème — 4,5:1 pour le texte, 3:1 pour contours de champs, focus et pastilles. `fire-2` (jaune officiel) est exempté : pastille toujours cerclée + libellé.
- **`tokens.css` à jour** : le test échoue si quelqu'un a modifié `tokens.json` sans régénérer (ou édité le fichier généré).
- **Anti-couleur en dur** (ESLint, `src/**`) : interdits les hex, `rgb()`/`hsl()`/`oklch()`…, `bg-[#…]` et les couleurs de la palette Tailwind. Aussi vérifié dans les `.css` (hors `tokens.css`). Seule exception : `style={{ background: 'var(--token)' }}`.
- Pour MapLibre (qui ne lit pas les variables CSS) : lire la valeur au runtime, `getComputedStyle(document.documentElement).getPropertyValue('--diff-red')`, et relire au changement de thème. Les réglages de la carte sont dans `--map-*`.

## Principes

- **La carte d'abord.** Elle occupe l'écran ; l'interface flotte par-dessus (boutons ronds, barre du bas, bottom sheet).
- **Une action principale par écran**, en `primary`, pleine largeur, en bas (`<Button size="lg">`). Le reste est secondaire ou fantôme.
- **Doux, pas fade.** Fond crème `background`, cartes `card`, ombres `shadow-sm`/`shadow-md` au plus, `rounded-2xl` sur cartes et panneaux. Un seul accent : `primary` (bleu nuit en clair, abricot en sombre), relayé par `accent` (abricot doux) pour la sélection.
- **Mobile first.** On dessine à 375 px puis on élargit (`lg:` = 1024 px). Rien d'uniquement au survol. Zones tactiles ≥ 44 px (`min-h-touch`, `size-touch`).

## Couleur

| Token | Usage |
|---|---|
| `background` / `foreground` | Page sable / bleu nuit, texte ardoise / crème |
| `card`, `popover` | Tout ce qui flotte : sheet, cartes, nav, champs, toasts |
| `muted` / `muted-foreground` | Creux (squelettes, poignée) / texte secondaire, attributions |
| `secondary` | Boutons secondaires |
| `primary` / `primary-foreground` | Action principale, nav active, liens, focus (`ring`) |
| `accent` / `accent-foreground` | Sélection douce (filtre actif, réponse choisie, survol) |
| `destructive`, `warning`, `success` (+ `-soft`) | États ; toujours un mot ou une icône avec la couleur |
| `border` / `input` | Séparateurs décoratifs / contour des champs (≥ 3:1) |

**Échelles métier, jamais sans libellé** (tables dans `src/lib/design/scales.ts`, badges dédiés) :
difficulté `diff-green` Facile · `diff-blue` Moyen · `diff-red` Difficile · `diff-black` Très difficile ;
massifs `fire-1`…`fire-5` (vert → noir, couleurs préfectorales) ; réponses `rsvp-yes` · `rsvp-maybe` · `rsvp-no`.
pentes `slope-up-1..5` (montée bleu → rouge) et `slope-down-1..5` (descente turquoise → magenta), **réservées au détail d'une trace**, valeurs de milieu de gamme identiques en clair/sombre car lisibles à la fois sur `card` et sur le fond clair de la carte (`map-base`, référence de contraste uniquement) ; classes dans `src/lib/geo/slopes.ts`.
`diff-black` et `fire-5` s'inversent en sombre. Jamais de texte en couleur d'échelle : la couleur va sur une pastille ou un tracé.

## Typographie

Une seule famille, **Inter** (auto-hébergée, `@fontsource-variable/inter`), repli pile système. Hiérarchie par taille et graisse, pas par la couleur.
Classes : `text-display` (une fois par écran), `text-title`, `text-heading`, `text-body` (16 px, défaut, aussi dans les champs), `text-small`, `text-label` (+ `uppercase`), `text-caption`, `text-stat` (+ `tabular-nums`).
Chiffres à la française via `src/lib/format.ts` : `32,1 km`, `662 m D+`, `3 h 30`, `dim. 15 nov. · 8 h 00` (espaces insécables).

## Espace, formes, mouvement

- Gouttière `px-gutter` (16 px) sur mobile, `lg:px-gutter-lg` (32 px) ; entre blocs d'une fiche `gap-block` (24 px).
- Rayons : `rounded-xl` boutons et champs, `rounded-2xl` cartes et panneaux, `rounded-3xl` haut du sheet, `rounded-full` pilules et boutons ronds.
- Tailles : `h-button-lg` (52), `h-nav` (64), `w-rail` (80), `w-panel` (400).
- Animations 150–200 ms `ease-out`, rien qui rebondit ; tout est coupé sous `prefers-reduced-motion` (`globals.css`).

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
