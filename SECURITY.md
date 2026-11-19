# Security policy

## Reporting a vulnerability

**Do not disclose a vulnerability in a public issue.** Use GitHub's private reporting:
the repository's **Security** tab → **Report a vulnerability** (GitHub Security Advisories).

Include the affected version (shown in the account menu and in `GET /api/health`), the steps to reproduce
and the estimated impact. You will get an acknowledgement within a few days; the fix ships in a patch
release, then the advisory is made public, with credit if you wish.

## Supported versions

Only the **latest published release** (`vX.Y.Z`, `latest` image) receives security fixes.

## Scope

In scope: the application, its Docker images, the public routes reached through a secret link (`/t`, `/s`, `/i`) and
ActivityPub federation (`/ap/*`, inbox). Out of scope: third-party services (OpenStreetMap, Open-Meteo, IGN…)
and installations modified by their operator.
