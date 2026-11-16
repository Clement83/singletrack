# Contribuer à singletrack

Merci de votre intérêt. Pas de CLA : vous gardez vos droits sur vos contributions, qui sont publiées sous la licence du dépôt, la GNU AGPL v3 ou ultérieure (voir `LICENSE`).

## Lancer le projet

```bash
cp .env.example .env        # renseigner BETTER_AUTH_SECRET et INVITE_LINK_KEY (openssl rand -base64 32)
docker compose up -d --build
```

L'application tourne en mode développement sur `http://localhost:3700` (rechargement à chaud). Toutes les commandes se lancent dans le conteneur :

```bash
docker compose exec app npm test
docker compose exec app npm run lint
docker compose exec app npx tsc --noEmit
```

Tests de bout en bout (éditeur, vrai Chromium via Playwright, profil `e2e` jamais lancé par défaut ; `-f` car `compose.yml` est le compose de distribution) :

```bash
docker compose -f docker-compose.yml --profile e2e run --rm e2e
```

Un compte `e2e@singletrack.test` et sa session sont posés en base par `scripts/e2e-session.ts` (aucun mail réel) ; ses traces sont effacées à chaque lancement. Le service `app-e2e` construit et sert l'app en production (`.next-build`, premier lancement ≈ 1 à 2 min) : `next dev` rechargerait la page en boucle sous Playwright. Scénarios dans `e2e/tests/` ; ceux des bugs #1524 à #1527 sont en `test.fixme`, à activer par chaque ticket.

## Conventions

- **Français et anglais obligatoires** : aucun texte en dur, une clé dans `messages/fr.json` **et** `messages/en.json`.
- **Tokens de design** : pas de couleur en dur, voir `design/README.md` (`npm run tokens`).
- **Mobile first** : vérifier à 375 px et en desktop, clair et sombre.
- **Tests** : tout comportement nouveau ou corrigé a son test ; tests, lint et typecheck passent avant la PR.
- **Migrations** : ne jamais modifier une migration existante (publiée ou non appliquée ailleurs), en ajouter une. La CI le vérifie (`scripts/upgrade-test.sh` : base du dernier tag + migrations courantes, fichiers publiés identiques).
- **Commits conventionnels** (`feat:`, `fix:`, `chore:`, `docs:`…) : ils alimentent `CHANGELOG.md` et les notes de release.

## Versions et publication

Semver, version dans `package.json` (affichée dans le menu du compte et `GET /api/health`). `release-please` maintient une PR « release X.Y.Z » (bump + `CHANGELOG.md`) ; la fusionner crée le tag `vX.Y.Z` et la GitHub Release, et le tag publie les images versionnées (`images.yml`). Pour que le tag déclenche `images.yml` automatiquement, définir le secret `RELEASE_PLEASE_TOKEN` (un tag créé par `GITHUB_TOKEN` ne lance aucun workflow). Dependabot (npm groupé sauf `next-intl`, Actions, images Docker), CodeQL et `SECURITY.md` complètent le dispositif.
- Une PR = un sujet. Décrivez le « pourquoi ».
- Ne jamais committer de secret ni de donnée personnelle.
