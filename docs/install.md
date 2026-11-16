# Installer Singletrack sur votre serveur

Prérequis : un serveur (NAS, mini-PC, VPS) avec **Docker + Docker Compose**, ≈ 2 Go de RAM, quelques centaines de Mo de disque (≈ 770 Mo de plus pour le routage de toute la France), et pour l'envoi des mails de connexion un compte [Resend](https://resend.com) avec un domaine validé.

Toutes les commandes s'exécutent dans les conteneurs ; rien n'est à installer sur l'hôte (hors Docker et git).

## Installation rapide (images GHCR)

Le fichier `compose.yml` à la racine est le compose de **distribution** : il utilise les images publiées, sans rien construire.

```bash
mkdir singletrack && cd singletrack && mkdir scripts
B=https://raw.githubusercontent.com/Clement83/singletrack/main
curl -fsSLO $B/compose.yml && curl -fsSLO $B/.env.example
curl -fsSL $B/scripts/init-env.sh -o scripts/init-env.sh && chmod +x scripts/init-env.sh
./scripts/init-env.sh https://vtt.example.org     # .env + secrets + ./data (sans argument : éditer BETTER_AUTH_URL)
docker compose up -d
docker compose run --rm tools npm run user:create -- --email vous@example.org --name Prénom
```

- **Tuiles BRouter** : le service `brouter-init` télécharge au premier lancement les tuiles de `BROUTER_TILES` (`france` ≈ 770 Mo par défaut, `home` = tuile du point maison, liste `E5_N40,W5_N40`, ou `none`), puis s'arrête ; les tuiles déjà présentes sont conservées. Sans tuile (ou si le téléchargement échoue), l'éditeur passe en ligne droite ; relancez `docker compose up -d` pour réessayer.
- **Synchros de traces** (à la main, idempotentes) : `docker compose run --rm tools npm run sync:osm -- 83 06`, `sync:singles`, `sync:geotrek`. Le service `tools` (profil `tools`, image `singletrack-tools`) contient les scripts ; il partage `./data` avec l'application.
- **Mise à jour** : sauvegardez `./data` et `.env` (voir §6), puis `docker compose pull && docker compose up -d`. Version épinglée : `SINGLETRACK_TAG=X.Y.Z` dans `.env` (`edge` = dernier commit de `main`).
- **Vérification** : la CI joue ce parcours à chaque changement (`scripts/install-test.sh` : `compose up --wait`, `/api/health`, `/login`, création d'un compte, `down`), hors recalage BRouter.

Les sections 1 à 7 ci-dessous décrivent l'installation **depuis le code source** (clone git, compose de développement) ; les variables de `.env` et les sections 4 à 6 valent pour les deux.

## 1. Récupérer le code et configurer

```bash
git clone https://github.com/Clement83/singletrack.git
cd singletrack
cp .env.example .env
```

Éditez `.env` (chaque variable est commentée : obligatoire ou facultative). L'essentiel :

| Variable | À faire |
| --- | --- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `INVITE_LINK_KEY` | `openssl rand -base64 32` — **à conserver, ne jamais la changer** (sauvegardez-la avec `.env`) |
| `FEDERATION_KEY_ENC` | clé de la fédération ActivityPub : `openssl rand -base64 32` (à conserver, ne jamais la changer ; `init-env.sh` la génère). **La fédération est active par défaut dès que cette clé existe** ; `FEDERATION=off` la coupe — voir `docs/federation.md` |
| `ADMIN_EMAILS` | emails des administrateurs (séparés par des virgules) : accès à `/admin/federation` pour bloquer des serveurs, lire les signalements et le journal des refus |
| `BETTER_AUTH_URL` | l'URL publique, ex. `https://vtt.example.org` (sans slash final) |
| `AUTH_TRUSTED_ORIGINS` | cette URL, plus l'accès LAN éventuel (`http://<IP_LAN>:3700`) |
| `APP_PORT` | port publié sur l'hôte (défaut `3700`) |
| `RESEND_API_KEY`, `MAIL_FROM` | clé Resend et expéditeur sur un domaine validé |
| `HOME_LAT`, `HOME_LON` | votre point « maison » : centre de la carte et référence des distances (défaut : centre de la France) |
| `SYNC_ZONES` | vos départements, ex. `83,06` (vide = toute la France, plusieurs heures) |
| `DATA_SOURCES` | facultatif : n'activer que certaines sources (voir ci-dessous) |

Pour un premier essai sans HTTPS ni nom de domaine : `BETTER_AUTH_URL=http://IP:3700`, `AUTH_TRUSTED_ORIGINS=http://IP:3700`, `AUTH_SECURE_COOKIES=false`.

### Sources de données

`DATA_SOURCES` (vide = toutes) : `osm`, `geotrek`, `ign`, `openmeteo`, `fire83`, `hunting83`. L'incendie (`fire83`) et la chasse (`hunting83`) ne couvrent que le **Var** : ailleurs, ces rubriques affichent « non disponible ». Respectez les licences des données (voir le [README](../README.md#données-tierces)).

## 2. Télécharger le routage (BRouter)

```bash
./scripts/get-brouter-segments.sh          # tuile(s) de la zone de HOME_LAT/HOME_LON (≈ 60–250 Mo)
./scripts/get-brouter-segments.sh france   # ou la France entière (≈ 770 Mo)
./scripts/get-brouter-segments.sh E5_N40   # ou des tuiles de 5° choisies (nom = coin sud-ouest)
```

Idempotent. Après un ajout de tuiles : `docker compose restart brouter`. Le service `brouter` ne passe en bonne santé que si la tuile de votre point maison est présente : lancez ce script **avant** `up`.

## 3. Démarrer

```bash
docker compose up -d --build
docker compose ps           # app et brouter « healthy » (la 1re compilation dure 1 à 2 minutes)
curl http://localhost:3700/api/health
```

La base SQLite est créée et migrée au démarrage, dans `./data/`.

> **Mode dev ou production ?** Le `docker-compose.yml` livré est en mode dev (rechargement à chaud, code monté). Pour une installation durable, utilisez l'image de production : dans `docker-compose.yml`, remplacez `target: dev` par `target: runner`, passez `NODE_ENV` à `production`, et remplacez les volumes de `app` par le seul `- ./data:/app/data` (les commentaires du fichier le rappellent). Sur un hôte sans souci de réseau compose, vous pouvez aussi retirer `network_mode: bridge` et `links`.

## 4. Premier compte et premières données

La connexion se fait **sans mot de passe** (code, lien et QR code reçus par mail). Soit ouvrez l'URL et connectez-vous avec votre adresse (compte créé à la première connexion tant que `AUTH_DISABLE_SIGNUP=false`), soit créez le compte :

```bash
docker compose exec app npm run user:create -- --email vous@example.org --name Prénom
```

Sans `RESEND_API_KEY`, aucun mail ne part : le code est écrit dans les logs (`docker compose logs app`), utile pour un premier essai. Pour fermer les inscriptions ensuite : `AUTH_DISABLE_SIGNUP=true` (puis `docker compose up -d`).

Importez les traces de vos zones (`SYNC_ZONES`, ou en argument) :

```bash
docker compose exec app npm run sync:osm         # itinéraires VTT OSM (un département après l'autre)
docker compose exec app npm run sync:singles     # calque des singles OSM
docker compose exec app npm run sync:geotrek     # circuits officiels des parcs (facultatif)
docker compose exec app npm run sync:osm -- 83 06   # zones explicites
```

Chaque script est idempotent : relancez-le pour rafraîchir (par exemple chaque mois, via cron).

## 5. HTTPS derrière un reverse proxy

Les liens partagés (`/s`, `/t`, `/i`) doivent être joignables **sans SSO** : l'application a sa propre authentification. N'ajoutez donc pas de portail devant. Exemple nginx (certificat Let's Encrypt, ex. `certbot --nginx -d vtt.example.org`) :

```nginx
server {
    listen 443 ssl http2;
    server_name vtt.example.org;
    ssl_certificate     /etc/letsencrypt/live/vtt.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vtt.example.org/privkey.pem;
    client_max_body_size 20m;                       # photos et GPX

    location / {
        proxy_pass http://127.0.0.1:3700;           # APP_PORT
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;     # rechargement à chaud en mode dev
        proxy_set_header Connection "upgrade";
    }
}
```

Caddy (facultatif) fait le même travail, certificat automatique compris :

```caddy
vtt.example.org {
    reverse_proxy 127.0.0.1:3700
}
```

Puis `BETTER_AUTH_URL=https://vtt.example.org`, `AUTH_SECURE_COOKIES=true`, et ce domaine dans `AUTH_TRUSTED_ORIGINS` (et `ALLOWED_DEV_ORIGINS` en mode dev).

## 6. Sauvegarde

Tout l'état est dans `./data/` (hors `data/brouter/segments`, re-téléchargeable) et dans `.env` :

- `data/singletrack.db` (+ `-wal` / `-shm`) : traces, sorties, comptes ;
- `data/media/` : photos des sorties ;
- `.env` : en particulier `INVITE_LINK_KEY` et `BETTER_AUTH_SECRET`.

Sauvegarde à chaud cohérente de la base :

```bash
docker compose exec app node -e "require('better-sqlite3')('/app/data/singletrack.db').backup('/app/data/backup.db').then(()=>console.log('ok'))"
```

puis copiez `data/backup.db`, `data/media/` et `.env` hors du serveur. Restauration : arrêter (`docker compose down`), remettre les fichiers, redémarrer.

## 7. Mise à jour

```bash
git pull
docker compose up -d --build
```

Les migrations s'appliquent au démarrage. Lisez l'historique git si un changement de `.env` est annoncé (comparez avec `.env.example`).

## Dépannage

- **Connexion : 403** : l'origine de votre navigateur n'est pas dans `AUTH_TRUSTED_ORIGINS`.
- **Connexion impossible en `http://IP`** : `AUTH_SECURE_COOKIES` doit être `false` hors HTTPS.
- **`brouter` « unhealthy »** : la tuile du point maison manque (étape 2), puis `docker compose restart brouter`.
- **Pas de mail** : `RESEND_API_KEY` vide, ou domaine d'envoi non validé ; consultez `docker compose logs app`.
- **L'app refuse de démarrer en production** : `INVITE_LINK_KEY` manquante ou invalide.

## Images publiées (GHCR)

Le workflow `.github/workflows/images.yml` publie, pour `linux/amd64` et `linux/arm64` (provenance + SBOM) :

- `ghcr.io/clement83/singletrack` (cible `release` du Dockerfile : build standalone sans devDependencies, utilisateur `node`, données dans `/app/data`) ;
- `ghcr.io/clement83/singletrack-brouter` (profils maison, sans tuiles `.rd5`) ;
- `ghcr.io/clement83/singletrack-tools` (cible `runner`, scripts de synchro et de gestion des comptes).

Images : `singletrack` (application), `singletrack-brouter`, `singletrack-tools` (cible `runner`, avec les scripts de synchro). Tags : `edge` à chaque push sur `main` ; `X.Y.Z`, `X.Y` et `latest` sur un tag `vX.Y.Z`. Le paquet doit être rendu public une fois dans l'interface GitHub.
