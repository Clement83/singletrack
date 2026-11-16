# Fédération ActivityPub — étude et décisions (#1471, epic #1470)

Statut : étude terminée le 2026-11-14 ; **P6 (#1476, sorties entre serveurs) livré**, voir §10 ; **P5 (#1475, copains entre serveurs) livré**, voir §9 ; **P4 (#1474) livré** : identité, WebFinger, NodeInfo, acteur, signatures, file d'envoi, `remote_actor` (voir §8). Le spike de `spikes/federation/` valide **Fedify 2.4.5**. Les tickets P4 à P7 s'appuient sur ce document.

## 1. Décisions de Clément (2026-11-14)

- Protocole **ActivityPub**, bibliothèque **Fedify** (validée par le spike, §3).
- **Ouvert à tous les serveurs**, sans liste blanche. La modération (P7) est donc obligatoire avant d'activer en production.
- **AGPL v3, sans CLA.** Pas de politique d'usage du nom.
- Périmètre v1 : **copains + sorties**, toutes visibilités. Fédération **activée par défaut** dans la version distribuée, après P7.
- **Jamais fédéré** : liens `/i/<token>`, invités sans compte, carnet de potes, emails, brouillons.
- Le serveur de l'organisateur reste la référence d'une sortie. Une suppression envoyée ailleurs n'est pas garantie.
- Vision : un Komoot/Strava fédéré, VTT seulement pour l'instant. Rien ici ne doit coder en dur ce serveur.

## 2. Identifiant fédéré (`handle`)

Un compte n'a aujourd'hui qu'un email et un prénom. Règle retenue (recommandation du ticket, confirmée par l'étude) :

| Point | Règle |
|---|---|
| Colonne | `user.handle`, unique, **insensible à la casse** (stocké en minuscules, index unique) |
| Alphabet | `[a-z0-9_]`, 3 à 30 caractères |
| Génération | à la création du compte, depuis le prénom : minuscules, accents retirés (NFD), tout hors `[a-z0-9_]` supprimé, complété à 3 caractères (`user` + suffixe) si trop court, puis suffixe numérique au premier conflit (`alice`, `alice2`, `alice3`…) |
| Compte sans prénom (`/bienvenue` pas encore passée) | handle généré **au moment où le prénom est saisi**, jamais depuis l'email |
| Modification | **une seule fois**, dans le menu utilisateur. Colonne `handle_changed_at` (NULL = jamais modifié) |
| Réservés | `admin`, `root`, `support`, `ap`, `api`, `inbox`, `actor`, `instance`, `singletrack`, `nodeinfo`, `well-known` et leurs équivalents (liste dans le code, testée) |
| Adresse | `handle@<domaine de l'instance>` (WebFinger `acct:handle@domaine`) |
| Email | **jamais exposé** : ni dans l'acteur, ni dans WebFinger, ni dans une activité |

Pourquoi une seule modification : l'adresse d'un compte est ce que les copains distants ont mémorisé. Changer d'adresse oblige à un `Move` ActivityPub (hors v1). En v1 le changement est donc **refusé si le compte a déjà des copains distants** et l'interface le dit. Tant qu'il n'y en a pas (ou avant P5), changer ne casse rien.

Un ancien handle n'est pas réattribué à un autre compte (table `handle_history`, ou simple conservation de la valeur dans `handle_changed_at`/un champ `previous_handle`, à trancher en P4).

Domaine : l'acteur est identifié par son URL (`https://<domaine>/ap/users/<handle>`), **jamais par l'identifiant interne** de la base. Le domaine vient de la configuration (`BETTER_AUTH_URL`/`PUBLIC_URL`), pas d'un en-tête de requête (voir §3, piège de l'origine).

## 3. Spike Fedify : résultats

Code : `spikes/federation/` (jetable, hors build, exclu de tsc, ESLint et de l'image). Lancer : `docker compose -f spikes/federation/docker-compose.yml up -d`, puis `docker compose -f spikes/federation/docker-compose.yml exec spike node /w/check.mjs`.

**Verdict : Fedify convient.** Pas de repli maison nécessaire.

| Question du ticket | Résultat |
|---|---|
| Compatible Next.js 16 (App Router, `next dev`) ? | **Oui.** Paquet officiel `@fedify/next` : `fedifyWith(federation)()` exporté en `proxy` (Next 16 renomme `middleware` en `proxy`, déprécié sinon). Le singleton de la fédération doit vivre sur `globalThis` : sinon Next le recrée à chaque rechargement à chaud et lève « Listener already set for this type ». Le `output: standalone` n'a pas été testé dans le spike (le mode dev est le seul actif, #1464) : à vérifier en P4 avec `npm run build`. |
| KV et file de messages sur SQLite, sans Redis ni Postgres ? | **Oui, sans rien écrire** : `@fedify/sqlite` fournit `SqliteKvStore` et `SqliteMessageQueue` (tables `fedify_kv`, `fedify_message`, `fedify_message_locks`, créées seules). Ils utilisent le module expérimental **`node:sqlite`** de Node 22 (avertissement « SQLite is an experimental feature » dans les logs), pas better-sqlite3. Les tables Fedify vont dans **un fichier SQLite séparé** (`data/federation.db`), pour ne pas toucher aux migrations Drizzle ni verrouiller la base de l'app. Si `node:sqlite` pose problème : `KvStore`/`MessageQueue` sont de petites interfaces, une version better-sqlite3 tient en ~150 lignes. |
| Deux instances qui se trouvent par WebFinger ? | **Oui.** `GET /.well-known/webfinger?resource=acct:paul@hôte` renvoie le lien `self` vers l'acteur. |
| Échange d'une activité signée ? | **Oui, aller-retour validé** : `Follow` signé de l'instance 1 vers l'instance 2 (signature vérifiée, acteur distant résolu), puis `Accept` signé en retour, vérifié par l'instance 1. Les `Follow` et `Accept` passent par la **file SQLite** (envoi non immédiat) sans perte. Les clés RSA sont stockées en base (JWK) par un `setKeyPairsDispatcher` : à chiffrer en P4 (clé d'instance `.env`). |
| HTTP en local | `allowPrivateAddress: true` (drapeau de dev `FEDERATION_DEV_HTTP=1`). Il autorise aussi les adresses privées. **Jamais en production : HTTPS obligatoire**, le drapeau est absent du `.env.example`. |

**Pièges rencontrés (à reporter dans le code de P4) :**

1. **Fedify 2.x a déplacé le vocabulaire** dans `@fedify/vocab` : `Person`, `Follow`, `Accept`, `Endpoints`, `Create`, `Event`… ne s'importent plus de `@fedify/fedify`. L'oublier donne des classes `undefined` et l'erreur trompeuse « Listener already set for this type ».
2. **Une seule copie des paquets Fedify** : Turbopack en embarque deux (route et proxy) et `instanceof CryptographicKey` échoue (« The publicKey must be of type CryptographicKey »). Solution : `serverExternalPackages: ['@fedify/fedify', '@fedify/vocab', '@fedify/vocab-runtime', '@fedify/webfinger', '@fedify/sqlite']` dans `next.config.mjs`.
3. **Origine** : `ctx.origin` reprend l'hôte de la requête (`0.0.0.0` derrière `next dev -H 0.0.0.0`, ou l'hôte interne derrière nginx). Les ID d'activité générés automatiquement prennent cette origine et le serveur distant répond **401 « the activity and its actors do not have the same origin »**. Il faut : l'option `origin` de `createFederation` (domaine public), `ctx.canonicalOrigin` pour fabriquer les URL, et des **ID d'activité explicites**.
4. **WebFinger** : `fedifyWith` ne traite que les requêtes dont l'en-tête `Accept` est ActivityPub/JRD ; un `fetch` sans `Accept` reçoit la page 404 de Next. Les vrais clients envoient le bon en-tête. Les tests d'intégration doivent le poser.
5. **`mapHandle`** est nécessaire pour que WebFinger retrouve un compte par son handle.
6. Les modules de la fédération gardent un état (file démarrée par `startQueue`) : en dev, un rechargement à chaud ne remplace pas le singleton, redémarrer le conteneur pour tester un changement de listener.
7. La **modification d'un listener** n'est prise en compte qu'après redémarrage (conséquence de 6).

**Non testé (pour P4/P6)** : `output: standalone`, réessais exponentiels sur 48 h (Fedify : `retryPolicy` configurable, à régler), RFC 9421 (Fedify négocie et mémorise la spec acceptée par l'hôte distant, `firstKnock`), interopérabilité avec un vrai Mastodon ou Mobilizon (hors v1).

**Deux conteneurs `app` / `app2`** : dans le compose de l'app, le réseau bridge sans DNS interdit les `links` croisés (dépendance cyclique), et le pool de réseaux compose est saturé. Le spike utilise **un conteneur, deux processus** (ports 3000 et 3001, deux bases). P4 fera de même pour ses tests d'intégration, ou demandera un réseau dédié si l'infra l'autorise.

## 4. Modèle de données

Ajouts à Drizzle (migrations **nouvelles**, jamais de modification d'une migration appliquée) :

| Table / colonne | Rôle | Ticket |
|---|---|---|
| `user.handle`, `user.handle_changed_at` | identité fédérée (§2) | P4 |
| `actor_key(user_id, public_pem, private_enc, created_at)` | paire de clés par compte, privée chiffrée (AES-256-GCM, clé `FEDERATION_KEY_ENC` sur le modèle d'`INVITE_LINK_KEY`) | P4 |
| `remote_actor(id, actor_url unique, handle, domain, display_name, inbox_url, shared_inbox_url, public_key_pem, fetched_at)` | cache des comptes distants | P4 |
| `friendship` : `remote_actor_id` nullable à côté de `user_id` | un copain, local **ou** distant, une seule notion | P5 |
| `delivery` : gérée par Fedify (`fedify_message`) | file d'envoi persistante | P4 |
| `remote_outing(id, object_url unique, remote_actor_id, title, starts_at, meeting_*, track_geojson, stats, status, visibility, max_participants, yes_count, fetched_at, updated_at)` | cache des sorties distantes | P6 |
| `remote_response(remote_outing_id, user_id, answer)` | ma réponse locale à une sortie distante | P6 |
| `federation_block(domain|actor_url, kind, reason, created_at)` | blocages admin et utilisateur | P7 |
| `federation_log(at, direction, domain, type, outcome)` | journal des refus, sans contenu personnel | P7 |

Rien de ces tables ne contient d'email. `invitation`, `contact` (carnet) et `/i/<token>` restent **purement locaux**.

## 5. Flux ActivityPub (P4 à P7)

### Identité (P4)
- WebFinger, **NodeInfo 2.1** (`software.name = singletrack`, `openRegistrations` selon `AUTH_DISABLE_SIGNUP`).
- Acteur `Person` : `preferredUsername` = handle, `name` = prénom, `inbox`, `outbox`, `followers`, `following`, clé publique. Aucun email ni statistique. `profile_visibility = private` ⇒ l'acteur existe (indispensable aux signatures) mais n'expose que handle et prénom.
- **Boîte partagée** (`/ap/inbox`) pour limiter les envois par serveur.
- Signatures : Fedify gère cavage draft et RFC 9421 ; obligatoires en entrée et en sortie.

### Copains (P5)
| Action | Activité |
|---|---|
| Demander | `Follow` (objet = acteur distant) |
| Accepter | `Accept(Follow)` **et** un `Follow` en retour (l'amitié est mutuelle), accepté par `Accept` |
| Refuser | `Reject(Follow)` |
| Retirer | `Undo(Follow)` envoyé par le retireur ; le receveur supprime la relation et envoie `Undo(Follow)` de la sienne |

L'ami « copain » = **deux `Follow` acceptés dans les deux sens**. Une seule moitié = demande en attente. Demande croisée = acceptation (règle de #1432 conservée). La résolution d'une adresse inconnue renvoie la même réponse neutre que pour un email inconnu. Pas d'annuaire, pas de recherche.

### Sorties (P6)
**Objet** : `Event` (`@fedify/vocab`), propriétés : `name`, `content`, `startTime`, `location` (`Place` avec `latitude`/`longitude`), `maximumAttendeeCapacity`, `joinMode`, `eventStatus`. Extension `singletrack:track` (GeoJSON simplifié 5 m + stats + attribution/licence) dans le contexte JSON-LD de l'instance (préfixe publié sous `/ns/singletrack`).

**Adressage selon la visibilité** :

| Visibilité | `to` | `cc` | Qui reçoit |
|---|---|---|---|
| publique | `as:Public` | collection `followers` | tout le Fediverse |
| copains | collection `friends` de l'organisateur (collection privée, voir ci-dessous) | — | serveurs des copains seulement |
| sur invitation | **chaque acteur invité** (un par copain distant invité) | — | **seulement le serveur de chaque invité** |

La collection `friends` n'est pas `followers` (qui est publique par convention) : c'est une collection privée servie seulement aux serveurs qui en font partie, jamais énumérable.

Pas de `Public` pour une sortie non publique, **y compris en `cc`**. Distribution : `ctx.sendActivity(sender, recipients)` avec une liste d'acteurs explicite (jamais `"followers"` pour une sortie privée).

**Cycle** :
- Création : `Create(Event)`. Modification : `Update(Event)`. Annulation : `Update(Event)` avec `eventStatus: EventCancelled` (la sortie n'est jamais effacée, cohérent avec `cancelOuting`), suppression : `Delete(Event)` (`Tombstone`). Le serveur distant applique au mieux.
- Réponse d'un distant : `Join(Event)` (je viens), `TentativeAccept` (peut-être, vocabulaire ActivityStreams) et `Leave(Event)` (non). Le serveur de l'organisateur applique les règles de `outingPermissions`/`joinVisibleOuting` (places, sortie close, visibilité) puis répond `Accept(Join)` ou `Reject(Join)` (motif `full` / `closed` en `summary`). État renvoyé aussi dans `Update(Event)` (nombre de « je viens », places restantes).
- Retrait d'un invité : `Undo(Join)` ou `Reject` selon le côté.

**Ne part jamais** : `/i/<token>`, invités sans compte, carnet, emails, brouillons, commentaires (hors v1), photos et trace roulée (hors v1).

### Sécurité et modération (P7)
Blocage de serveur (le plus tôt possible dans l'inbox), de compte, limites de débit par serveur, taille d'activité, horloge (±12 h), signature obligatoire, journal des refus. Les blocs s'appliquent aussi à l'émission. Livré en P7 : voir §11.

## 6. Interrupteur et exposition

- `FEDERATION=on|off`. `off` (défaut jusqu'à P7) : aucune route ActivityPub ne répond (404 avant d'atteindre Fedify) et rien ne part. `on` par défaut après P7.
- Routes publiques à ajouter à `src/lib/public-routes.ts` : `/.well-known/webfinger`, `/.well-known/nodeinfo`, `/nodeinfo`, `/ap`, avec tests dans `tests/auth.test.ts`. **Le `proxy.ts` actuel devra appeler Fedify avant la redirection vers `/login`** (ordre à tester).
- nginx : le vhost de l'instance ne doit pas être derrière un SSO. Il doit transmettre `Host`, `X-Forwarded-Proto` et ne **pas** mettre en cache `/ap/*`. Les `POST` d'inbox peuvent être gros (trace) : `client_max_body_size` ≥ 1 Mo sur `/ap/`.

## 7. Impact sur les tickets P4 à P7

- **P4** : ajouter au périmètre `@fedify/vocab`, `@fedify/next`, `@fedify/sqlite`, la base `data/federation.db`, `serverExternalPackages`, le singleton `globalThis`, `origin` canonique, tests d'intégration en **un conteneur, deux processus**, et la règle de handle du §2 (dont `handle_changed_at`). Ordre du `proxy.ts`.
- **P5** : adopter le sous-modèle « deux `Follow` acceptés » du §5.
- **P6** : adressage « copains » par une collection privée, pas `followers` ; extension JSON-LD `singletrack:track` ; vocabulaire `Join` / `TentativeAccept` / `Leave` confirmé.
- **P7** : inchangé.
- Aucun nouveau blocage : pas de ticket `[Humain]` nécessaire. À surveiller : l'interopérabilité avec Mastodon/Mobilizon n'est pas testée.

## 8. État P4 (#1474)

Livré : `user.handle` / `handle_changed_at` / table `handle_history` (un ancien handle n'est jamais réattribué : tranché), `actor_key`, `remote_actor` (migration 0022) ; WebFinger, NodeInfo 2.1, acteur `Person` (handle et prénom seulement), boîtes d'entrée (acteur et partagée) avec signatures vérifiées par Fedify, outbox/followers/following vides (P5, P6), file SQLite `data/federation.db` avec réessais exponentiels ~48 h (1 min, 2, 4… plafonné à 8 h, 14 réessais) ; `FEDERATION=off` par défaut ; menu utilisateur : adresse fédérée copiable (si `FEDERATION=on`) et modification unique du handle.

Décisions : l'acteur distant est mis en cache à chaque activité signée reçue ; `hasRemoteFriends` (`src/lib/federation/handle.ts`) renvoie `false` jusqu'à P5, qui doit le brancher sur `friendship` ; `FEDERATION_KEY_ENC` est exigée au démarrage si `FEDERATION=on` ; l'adresse n'est pas affichée si la fédération est coupée. Vérifié : `next build` (standalone) et image `runner` contiennent les paquets Fedify ; échange signé `Follow` entre deux instances (`scripts/federation-two-instances.ts`). Non fait : interopérabilité avec un vrai Mastodon, RFC 9421 non testé explicitement (Fedify négocie), chiffrement des clés déjà existantes si `FEDERATION_KEY_ENC` change (impossible, à ne jamais changer).


## 9. État P5 (#1475) : copains entre serveurs

Code : `src/lib/federation/friends.ts` (logique et envoi), écouteurs `Follow` / `Accept` / `Reject` / `Undo` dans `src/lib/federation/index.ts`, notion unique de copain dans `src/lib/friends.ts`. Migration 0023.

- **Modèle** : une ligne `friendship` par amitié, locale **ou** distante. Un copain distant = un compte local (`requester_id` ou `addressee_id`, l'autre à NULL) + `remote_actor_id` ; `remote_follow_id` garde l'URL du `Follow` reçu pour y répondre. `pair_key` = `<user>:r:<remote_actor>`. `contact.remote_actor_id` lie un pote du carnet à un copain distant (exclusif avec `contact.user_id`). `status` : `pending` tant qu'une moitié manque, `accepted` quand les deux `Follow` sont acquis.
- **Flux** : demander = `Follow` (id `/ap/follows/<id>`) ; accepter = `Accept(Follow)` **et** `Follow` en retour (`<id>-back`), confirmé par un `Accept` ; refuser = `Reject` ; annuler ou retirer = `Undo(Follow)`, le receveur supprime la relation et envoie l'`Undo` de son propre `Follow` ; demande croisée = acceptation.
- **Demande** : champ « adresse » de `/copains` (visible si `FEDERATION=on`), `POST /api/friends {address}`. Résolution WebFinger par Fedify (délai 8 s). Adresse introuvable ⇒ même réponse que pour un email inconnu (`202`, rien créé). Une adresse de ce serveur est traitée en local. Les activités sont émises **seulement** si `FEDERATION=on` et passent par la file (réessais ~48 h).
- **Une seule notion de copain** : `listFriends` renvoie locaux et distants (`userId` NULL + `remote` pour les distants), `removeFriendship` / `respondToRequest` / `linkContact` les gèrent, `hasRemoteFriends` verrouille le changement de handle. `outingPermissions` (`areFriendsOf`) reste **local** : un copain distant n'a pas de session ici, il verra les sorties « copains » depuis son serveur (P6, via `remoteFriendActorIds` / `isRemoteFriend`). `listInvitableFriends` n'offre que des comptes locaux (invitations distantes : P6).
- **UI** : badge « autre serveur · domaine » sur la carte, lien vers son profil sur son serveur (pas de copie de stats), pas de lien d'invitation pour un copain distant.
- **Limites** : un acteur distant qui n'envoie pas d'`Accept` laisse la demande en attente indéfiniment (pas d'expiration) ; pas de blocage de serveur avant P7 (#1477).


## 10. État P6 (#1476) : sorties entre serveurs

Code : `src/lib/federation/outings.ts` (logique, sérialisation, envoi), écouteurs `Create` / `Update` / `Delete` / `Join` / `TentativeAccept` / `Leave` (et `Accept` / `Reject` de `Join`) dans `src/lib/federation/index.ts`, branchements dans `src/lib/outings/federation-hook.ts` (appelé par `service.ts`), invitation de copains distants dans `src/lib/outings/friend-invites.ts`. Migration 0024 : `remote_outing`, `remote_response`, `invitation.remote_actor_id` (+ origine `remote`). Tests : `tests/federation-outings.test.ts` (deux serveurs en mémoire + serveur Fedify factice).

- **Objet** : `Event` avec `name`, `content`, `startTime`, `location` (`Place` lat/lon), `attributedTo`. **Écart avec l'étude** : `@fedify/vocab` n'a ni `maximumAttendeeCapacity`, ni `joinMode`, ni propriété d'extension libre. Tout ce qui manque (trace figée en GeoJSON simplifié + stats + attribution/licence, places, niveau, VAE, statut, nombre de « je viens ») voyage dans **une pièce jointe `Document` nommée `singletrack:outing`** dont l'URL est un `data:application/json;base64,…` (≤ 600 Ko : la trace est re-simplifiée à 10, 20, 40, 80 m au besoin). Lue de façon défensive (`parseExt` : énumérations, bornes, 100 000 points max). Le **slug de la trace** (lien secret `/t/<uuid>`) n'est jamais envoyé.
- **Adressage** (`deliverOutingWithFedify`) : publique = `Public` + `followers` ; copains = collection `/ap/users/<handle>/friends`, **jamais servie** (pas de dispatcher : 404, non énumérable) ; sur invitation = une activité par invité, `to` = cet acteur seulement. Destinataires (`recipientsOf`) : invités distants (toutes visibilités) + copains distants acceptés (publique, copains). Sur invitation, un copain non invité ne reçoit rien.
- **Qui voit quoi, côté distant** (`listRemoteOutings`) : publique = tout compte ; copains = comptes copains de l'organisateur ; sur invitation = comptes nommés dans `to` **et** copains de l'organisateur (une invitation d'un inconnu est ignorée), matérialisés par une ligne `remote_response` en attente + le mail d'invitation (lien vers `/sorties/distante/<id>`, jamais `/i/`).
- **Réponses** : `Join` (je viens), `TentativeAccept` (peut-être), `Leave` (non), id `/ap/joins/<uuid>`. L'organisateur applique les mêmes règles qu'en local (visibilité, sortie close, places) à une ligne `invitation` (`remote_actor_id`, origine `remote`, sans jeton : `token_hash` jeté), puis `Accept` / `Reject(Join)` (`summary` = `full` / `closed` / `forbidden`) et un `Update(Event)` au seul répondant (nombre de « je viens » à jour). Un acteur sans droit : silence.
- **Propagation** : création → `Create` ; modification, changement de trace, passage en publique, **annulation** (statut `cancelled`, comme `cancelOuting`, rien n'est effacé) → `Update(Event)` ; invité distant retiré → `Delete(Tombstone)` vers son serveur seul. Les envois partent en arrière-plan par la file (réessais ~48 h), uniquement si `FEDERATION=on`. Une suppression ou une annulation distante **n'est pas garantie** : texte dans le formulaire de sortie (`outingVisibility.form.federationNote`) et sur la fiche distante.
- **Sécurité** : l'objet doit être attribué à l'acteur signataire et hébergé sur son domaine ; une copie n'est jamais modifiée par un autre acteur ; `Delete` et `Accept`/`Reject` ne valent que de l'organisateur ; l'URL d'un `Event` d'une autre origine n'est jamais une sortie d'ici. `GET /ap/outings/<id>` ne renvoie que les sorties **publiques**.
- **UI** : « Mes sorties » liste les sorties d'autres serveurs (badge « autre serveur · domaine », « Je viens » en un tap), fiche `/sorties/distante/<id>` (3 réponses, état confirmé / refusé avec motif, attribution de la trace). Inviter ses copains propose aussi les copains distants (`remote:<acteur>`).
- **Limites v1** (à suivre) : les sorties distantes n'apparaissent pas encore sur la carte (#1461) ni dans la fiche de découverte, pas de météo / incendie / chasse calculés sur la copie ; une publique n'est poussée qu'aux copains distants (les abonnés `followers` du Fediverse ne sont pas suivis avant P7) ; le nombre de « je viens » d'autres invités n'est rafraîchi chez un distant qu'au prochain `Update` ; le transfert d'une sortie à un autre propriétaire ne ré-attribue pas l'`Event` ; pas de commentaires ni de photos fédérés (hors v1).

## 11. État P7 (#1477) : sécurité, modération, activation par défaut

Code : `src/lib/federation/moderation.ts` (règles et limites, constante `LIMITS`), `inbox-guard.ts` (filtre avant Fedify, appelé par `src/proxy.ts`), `src/lib/admin.ts` (`assertAdmin`). Migration 0025 : `federation_block`, `remote_actor_block`, `federation_log`, `federation_report`.

- **Administrateur** : emails de `ADMIN_EMAILS` (insensible à la casse). Page `/admin/federation` (404 pour les autres), routes `/api/admin/federation/*` (401 sans session, 403 sinon).
- **Serveur bloqué** (domaine ; un domaine bloque aussi ses sous-domaines) : refus **dès l'entrée** (403, avant la signature), rien n'est mis en cache, **rien n'est envoyé** (`safeDeliver`, `send`, recherche d'adresse), et à l'ajout les copains, sorties en cache et invitations de ce serveur sont retirés. Liste éditable, import facultatif d'un CSV Mastodon (lignes `suspend`, domaines masqués ignorés).
- **Compte bloqué** par un utilisateur (`remote_actor_block`, bouton sur la fiche d'une sortie distante et sur une demande de copain reçue ; liste + déblocage dans « Mes copains ») : amitié et réponses retirées, ses `Follow`, invitations et sorties n'arrivent plus.
- **Limites** : 60 activités/min par serveur (429) ; 256 Ko par activité, lecture bornée du corps (413) ; 200 sorties en cache par serveur (les nouvelles sont refusées, les mises à jour passent) ; copies expirées 30 jours après le début de la sortie ; horloge ±12 h (`signatureTimeWindow` de Fedify) ; signature obligatoire (Fedify, 401 journalisé) ; `Delete` d'un acteur inconnu ignoré (202).
- **Anti-spam** : demandes de copain d'un serveur « jamais vu » (aucun copain accepté chez lui) : 5 par jour et par compte destinataire, le reste ignoré. Pas d'annuaire ni de recherche de comptes.
- **Signalement** : « Signaler » sur une sortie distante → ligne `federation_report` (une par compte et par sortie) + `Flag` (acteur de l'organisateur et objet) au serveur d'origine ; l'admin local voit la copie.
- **Journal des refus** (`federation_log`) : domaine, motif, type d'activité, jamais de contenu ; 1 000 lignes gardées.
- **Limite connue** : le filtrage précoce (blocage, débit) se fonde sur l'acteur **déclaré** par l'activité, non vérifié ; la vérification de signature suit, et le blocage est refait sur l'acteur vérifié. Un attaquant peut donc user le quota d'un domaine qu'il usurpe, jamais agir en son nom.
- **Activation par défaut** : `FEDERATION` non renseignée = `on` dès que `FEDERATION_KEY_ENC` existe (sans clé : éteinte, avertissement au démarrage) ; `FEDERATION=off` la coupe. L'activation sur le serveur de Clément reste à son initiative.
