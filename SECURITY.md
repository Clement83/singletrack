# Politique de sécurité

## Signaler une vulnérabilité

**Ne publiez pas de faille dans une issue publique.** Utilisez le signalement privé de GitHub :
onglet **Security** du dépôt → **Report a vulnerability** (GitHub Security Advisories).

Indiquez la version concernée (visible dans le menu du compte et dans `GET /api/health`), les étapes pour reproduire
et l'impact estimé. Vous recevrez un accusé de réception sous quelques jours ; la correction est publiée dans une version
corrective, puis l'avis est rendu public avec un crédit si vous le souhaitez.

## Versions prises en charge

Seule la **dernière version publiée** (`vX.Y.Z`, image `latest`) reçoit les correctifs de sécurité.

## Périmètre

Dans le périmètre : l'application, ses images Docker, les routes publiques par lien secret (`/t`, `/s`, `/i`) et la
fédération ActivityPub (`/ap/*`, boîte d'entrée). Hors périmètre : les services tiers (OpenStreetMap, Open-Meteo, IGN…)
et les installations modifiées par leur exploitant.
