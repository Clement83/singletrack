# Contributing to singletrack

Thanks for your interest. No CLA: you keep your rights on your contributions, which are released under the repository licence, the GNU AGPL v3 or later (see `LICENSE`).

## Running the project

```bash
cp .env.example .env        # fill in BETTER_AUTH_SECRET and INVITE_LINK_KEY (openssl rand -base64 32)
docker compose -f docker-compose.yml --profile dev up -d app-dev
```

The application runs in development mode on `http://localhost:3701` (hot reload). Every command runs in the container:

```bash
docker compose -f docker-compose.yml exec app-dev npm test
docker compose -f docker-compose.yml exec app-dev npm run lint
docker compose -f docker-compose.yml exec app-dev npx tsc --noEmit
```

End-to-end tests (editor and map, real Chromium through Playwright, `e2e` profile never started by default; `-f` because `compose.yml` is the distribution compose file):

```bash
docker compose -f docker-compose.yml --profile e2e run --rm e2e
```

An `e2e@singletrack.test` account and its session are written to the database by `scripts/e2e-session.ts` (no real email); its tracks are wiped on every run. The `app-e2e` service builds and serves the app in production mode (`.next-build`, first start ≈ 1 to 2 min): `next dev` would reload the page in a loop under Playwright. Scenarios live in `e2e/tests/`; those of bugs #1524 to #1527 are `test.fixme`, to be enabled by each fix.

## Conventions

- **French and English required**: no hard-coded UI text, one key in `messages/fr.json` **and** `messages/en.json`.
- **Everything else is in English**: code comments, documentation, commit messages, release notes (see the rule at the top of `AGENTS.md`).
- **Design tokens**: no hard-coded colour, see `design/README.md` (`npm run tokens`).
- **Mobile first**: check at 375 px and on desktop, light and dark.
- **Tests**: every new or fixed behaviour has its test; tests, lint and typecheck pass before the PR.
- **Migrations**: never modify an existing migration (published, or applied elsewhere), add a new one. CI checks it (`scripts/upgrade-test.sh`: database from the last tag + current migrations, published files unchanged).
- One PR = one topic. Explain the "why".
- Never commit a secret or personal data.

## Commit messages

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), in English:

```text
<type>(<scope>): <summary>

<body: what changed and why>

Refs: #1234
```

- **type**: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`; `!` after the scope (or a `BREAKING CHANGE:` footer) for a breaking change.
- **scope** (optional): the area touched, e.g. `map`, `editor`, `outings`, `tracks`, `auth`, `federation`, `i18n`, `ui`, `db`, `docker`, `release`, `smoke`.
- **summary**: imperative mood ("add", not "added"), lower case, no final period, first line at most 72 characters.
- **footer**: `Refs: #NNNN` points to the maintainer's task tracker (not to a GitHub issue); `Closes #N` closes a GitHub issue.
- One logical change per commit.

## Versions and releases

Semver, version in `package.json` (shown in the account menu and in `GET /api/health`). A maintainer cuts a release: version in `package.json`, `## [X.Y.Z]` section in `CHANGELOG.md`, then the `vX.Y.Z` tag; the tag creates the GitHub Release (`release.yml`, notes = the CHANGELOG section) and publishes the versioned images (`images.yml`). Full procedure: the "Releases" section of `AGENTS.md`. Dependabot (npm grouped except `next-intl`, Actions, Docker images), CodeQL and `SECURITY.md` complete the setup.
