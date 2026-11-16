---
name: ui-ux
description: Bonnes pratiques UI/UX de singletrack (interactions, accessibilité, formulaires, tactile, mobile first, typographie française) — règles Vercel Web Interface Guidelines adaptées à la charte du projet. À charger AVANT d'écrire ou de modifier tout composant, page ou style (src/app, src/components, globals.css), et pour un audit UI (« revois l'UI », « audit UX », « accessibilité »).
---

# UI/UX — singletrack

La **charte d'interface** et les **règles mobiles** de `AGENTS.md` font foi (simple, doux, mobile first, carte star, tokens et composants du design system #1363). Cette skill ajoute les règles d'exécution qui manquent souvent : un écran peut respecter la charte et rester pénible à utiliser (pas de curseur main, focus invisible, clavier numérique absent, double-tap qui zoome…).

Base : [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (MIT, © Vercel Labs), adaptées au français, à Tailwind 4 et à shadcn/ui. Les règles marquées **(ST)** sont propres à singletrack.

## Avant de coder

1. Lire la charte de `AGENTS.md` et `design/README.md`. Réutiliser `src/components/ui/*` (`Button`, `Field`, `Badge`, `BottomSheet`, `EmptyState`, `Skeleton`, `Toaster`) : ne jamais recréer un bouton ou un champ à la main.
2. Une seule action principale par écran (`Button size="lg"`, pleine largeur, en bas sur mobile).
3. Prévoir dès le départ les 4 états : chargement (squelette), vide (ton tutoyé + action), erreur (ce qui s'est passé + quoi faire), contenu long.

## Interactions et curseur

- Tout élément cliquable a `cursor: pointer` — **(ST)** posé globalement dans `globals.css` (`@layer base`) car Tailwind 4 ne le met plus sur `<button>`. Un élément cliquable qui n'est ni `<button>`, ni `<a>`, ni `role="button"` est un bug (voir Sémantique), pas un cas pour `cursor-pointer`.
- Désactivé : `disabled` (bouton) ou `aria-disabled="true"` (+ curseur `not-allowed` global), opacité réduite, pas de survol.
- Chaque bouton/lien a un état `hover:` **et** `active:` (le mobile n'a pas de survol : `active:` est le retour tactile). Les états interactifs augmentent le contraste, jamais l'inverse.
- **Jamais d'action uniquement au survol** (charte) ; un tooltip ne porte jamais d'information indispensable.
- Zones tactiles ≥ 44 px (`min-h-touch`, `size-touch`), espacées d'au moins 8 px.
- `touch-action: manipulation` sur les éléments interactifs (posé globalement) ; `-webkit-tap-highlight-color` transparent (posé) ⇒ le retour visuel vient de `active:`.
- Bouton d'envoi : actif jusqu'au départ de la requête, puis désactivé + spinner + libellé « Enregistrement… ». Pas de double envoi.
- Action destructive (supprimer, révoquer un lien, annuler une sortie) : confirmation ou annulation possible (toast « Annuler ») — jamais immédiate et définitive.
- Geste (glisser, pincer, balayer) : toujours une alternative au tap et au clavier.
- `autoFocus` : jamais sur mobile (ouvre le clavier et masque l'écran) ; desktop seulement, un seul champ principal.

## Focus et clavier

- Focus visible partout : `:focus-visible` global (anneau `--ring`). Jamais `outline-none` sans remplacement `focus-visible:ring-*`.
- `:focus-visible` plutôt que `:focus` ; `:focus-within` pour les contrôles composés.
- Ordre de tabulation = ordre visuel ; un `BottomSheet`/dialogue piège le focus et le rend à l'ouverture (Radix/vaul le font : ne pas le casser).
- Barre du bas, en-têtes collants et sheets ne recouvrent pas l'élément focalisé (`scroll-margin`/`scroll-padding`).

## Sémantique et accessibilité

- `<button>` pour une action, `<a>`/`<Link>` pour une navigation (clic molette, Ctrl+clic). Jamais `<div onClick>`.
- Bouton icône seule : `aria-label` en français (« Me localiser », « Fermer »). Icône décorative : `aria-hidden="true"` (lucide).
- Chaque champ a un `<label>` cliquable (`htmlFor`) — `Field` le fait.
- Messages asynchrones (toasts, validation, résultat d'un envoi) : `aria-live="polite"` (sonner le fait).
- Titres hiérarchiques `h1` → `h2`… ; un seul `h1` par page.
- Images : `alt` (ou `alt=""` si décorative), `width`/`height` explicites.
- Contraste AA (texte 4.5, UI 3) **en clair et en sombre** : `npm run tokens:check`.
- La couleur ne porte jamais seule une information (difficulté, incendie, pente) : libellé ou légende à côté.

## Formulaires (mobile)

- Bon `type` et `inputmode` : `email`, `tel`, `inputMode="numeric"` (codes, km, D+), `type="date"`/`time` natifs.
- `autoComplete` pertinent (`email`, `one-time-code`, `name`) et `name` explicite ; `autoComplete="off"` sur les champs non liés à l'identité.
- `spellCheck={false}` sur email, codes, identifiants. Ne jamais bloquer le collage.
- Erreurs sous le champ concerné, en clair, avec la solution ; focus sur la première erreur à l'envoi.
- Placeholder = exemple, finit par `…` (« ex. Col du Fenouillet… ») ; jamais à la place du label.
- Avertir avant de quitter avec des modifications non enregistrées (éditeur de traces, formulaires de sortie).
- Formulaires courts : demander le minimum, valeurs par défaut intelligentes.

## Mise en page mobile first

- Concevoir à 375 px, puis élargir (`md:`, `lg:`). Pas de scroll horizontal (`min-w-0` sur les enfants flex, `truncate`/`line-clamp`/`break-words` sur le texte).
- Plein écran : `env(safe-area-inset-*)` (encoche, barre de geste) — barre du bas, sheet, boutons fixés en bas.
- `overscroll-behavior: contain` dans les sheets, dialogues et listes défilantes.
- Mise en page par flex/grid, jamais par mesure JS.
- Pas de `user-scalable=no` ni `maximum-scale=1` : le zoom reste possible.
- **(ST)** Carte plein écran ou intégrée : suivre les « Règles mobiles » d'`AGENTS.md` (`BaseMap`, `LazyMap embedded`, `.map-touch`).

## Animation

- ≤ 200 ms, sobres (charte). `prefers-reduced-motion` respecté (coupure globale dans `globals.css`).
- Animer `transform`/`opacity` seulement ; jamais `transition: all` (`transition-colors`, `transition-[transform,opacity]`).
- Animations interruptibles par l'utilisateur.

## Typographie et textes (français) — (ST)

- Ton simple et **tutoyé**, voix active, verbes d'action précis : « Créer la sortie », pas « Valider » ni « OK ».
- **Pas de Title Case** (règle anglaise de Vercel) : majuscule au premier mot seulement.
- Ponctuation française : guillemets « », espace insécable (` `) avant `: ; ! ?` et entre nombre et unité (`12 km`, `350 m`), `…` et pas `...`, apostrophe typographique `’` dans les textes affichés.
- Chiffres pour les quantités (« 3 invités »), `font-variant-numeric: tabular-nums` (`tabular-nums`) pour les stats et colonnes de chiffres.
- Dates, heures, nombres : `Intl.DateTimeFormat`/`Intl.NumberFormat` en `fr-FR`, fuseau `Europe/Paris` ; attention aux écarts d'hydratation serveur/client sur les dates.
- Titres : `text-balance` ; paragraphes : `text-pretty`.
- Messages d'erreur : ce qui s'est passé + quoi faire (« Pas de réseau — on réessaie dès que tu es de retour »).

## Thème

- Couleurs **uniquement** via les tokens (`bg-primary`, `text-muted-foreground`…) : jamais de couleur en dur (lint + tests).
- Vérifier chaque écran en clair et en sombre ; `<select>` natifs lisibles en sombre (fond et couleur explicites).
- `theme-color` cohérent avec le fond.

## Performance perçue

- Squelettes plutôt que spinners plein écran ; pas de saut de mise en page (dimensions réservées).
- Listes > 50 éléments : virtualiser ou `content-visibility: auto`.
- Pas de lecture de layout (`getBoundingClientRect`…) pendant le rendu.
- Voir aussi la skill `react-performance` pour React/Next.

## Audit d'un écran (checklist de fin de ticket UI)

Pour chaque fichier touché, vérifier les règles ci-dessus et rendre les écarts au format `fichier:ligne - problème`, groupés par fichier (`✓ ok` si rien). Puis, dans l'app reconstruite :

1. 375 px et desktop, clair et sombre (captures exigées par la charte).
2. Tout au **clavier** seul : Tab, Entrée, Échap, focus toujours visible.
3. Curseur main sur tout ce qui est cliquable, état `active:` au doigt.
4. États vide / chargement / erreur / texte très long.
5. Lighthouse accessibilité (voir `AGENTS.md`).

Un écart trouvé hors du périmètre du ticket devient un ticket, il ne se corrige pas en douce.
