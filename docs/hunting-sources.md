# Sources des jours de chasse / battues (étude #1572)

Étude du 2026-11-17, **sans intégration** (suite de #1354, #1469, #1488). Dérogation de Clément du 2026-11-16 : extraction autorisée pour ce POC seulement ; si une source convient, Clément demande l'autorisation à l'éditeur **avant** toute intégration. Scripts jetables : [`spikes/hunting/`](../spikes/hunting/).

## Conclusion

**Aucune source de battues déclarées n'est exploitable dans le Var aujourd'hui.** Les deux seules sources techniquement propres (JSON avec polygones, dates futures) couvrent **un seul territoire dans l'Oise** (Ça chasse ?) et **le Bas-Rhin / Alsace bossue** (CynePortail). Pour le Var, la seule information officielle et complète reste les **arrêtés préfectoraux** (déjà intégrés par #1354, « minimum garanti »).

Régions où une donnée est exploitable : **Alsace (Bas-Rhin)**, via CynePortail (684 lots, ~3 semaines de battues à venir). Isère, Savoie, Hérault, Jura ont des applis locales, non vérifiées techniquement (voir tableau).

## Tableau des sources

| # | Source | Couverture | Granularité | Dates | Accès | robots / CGU | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **Arrêtés préfectoraux Var** (var.gouv.fr, FDC 83) | **Tout le Var**, officiel | département (saison, périodes de battue sanglier) | saison entière | PDF, 1×/an | actes publics | **Déjà intégré** (#1354). Pas de « battue ici ce jour ». |
| 2 | **CynePortail** (cyneportail.fr/declarations/timeline) | **Bas-Rhin** : 16 circonscriptions, 684 lots, 202 communes ; emprise lon 6,95–8,23 / lat 48,12–49,08. **0 lot dans le Var.** | **polygone du lot de chasse** + commune | jours futurs et passés sur 30 j (17/11/2026 → 04/01/2027) | **JSON same-origin** `GET /declarations/timeline/geojson` (1 appel, ~10 Mo, sans clé) | robots.txt : rien d'interdit ; pas de CGU ni licence trouvées | Meilleure donnée technique, **hors Var** |
| 3 | **Ça chasse ?** (ca-chasse.com) | **1 territoire** : Croutoy (Oise). 0 dans le Var, J, J+30, J+60 | polygone par commune | J à `maxDate` (~3 mois) | JSON `GET /api/today?date=…` (UA navigateur requis) | robots Allow ; CGU : « extraction massive, surcharge » interdites, pas de licence | Bon format, **aucune donnée**. À re-tester (1 appel). |
| 4 | **Chassé & Croisé** (FFRandonnée) | Sud-Ouest surtout (étude #1354) ; Var non vérifié | zone de battue | temps réel | appli mobile, pas d'API publique constatée | mode « privé » payant qui masque des zones | Écarté |
| 5 | **Info Battue** (info-battue.lovable.app) | « France », projet amateur, publicité Google | carte | en cours / à venir | appli JS ; aucun endpoint repéré dans la page servie (non creusé) | aucune CGU trouvée | Écarté (fiabilité inconnue) |
| 6 | **FDC 83** (fdc83.com) | Var | — | — | site WordPress, arrêtés en PDF ; `/public.api/` et `*.json` interdits par robots.txt | — | Aucune carte de battues publiée (page d'accueil mentionne « battue » seulement pour la réglementation) |
| 7 | **ONF** (calendriers des chasses en forêt domaniale) | forêts domaniales, par forêt (Fontainebleau, Fougères…). Var : non trouvé | forêt | jours de chasse de la saison | **PDF** relayés par les communes | public | Pas de format machine ; à vérifier pour les forêts domaniales du Var |
| 8 | Applis locales : **Chasse Info** (Isère), **Land Share** (Savoie), **Melckone** (Hérault), WeHunt (FDC 77), ChasseOnWeb (Wallonie) | départements/pays concernés, **pas le Var** | zones de battue | temps réel | appli ; non testé | — | Hors Var, non testé |
| 9 | **ChassOuverte** (Jura) | Jura | — | — | logiciel libre, pas de carte publique | libre | Idéal si la FDC 83 l'adoptait un jour |
| 10 | Mairies / sociétés de chasse / ACCA / panneaux | locale | commune | variable | PDF, Panneau Pocket, affichage | — | Impossible à agréger |

Toutes ces données sont **déclaratives et non exhaustives** : aucune source ne permet d'affirmer « pas de chasse ici ».

## Extractions réelles (2026-11-17, scripts de `spikes/hunting/`)

**Ça chasse ?** (3 appels, 1,5 s d'écart) :

```
2026-11-17 zones actives 0 territoires 0 features 1 dans le Var 0 territoires: Territoire Croutoy chasse
2026-12-17 zones actives 0 territoires 0 features 1 dans le Var 0 territoires: Territoire Croutoy chasse
2027-01-16 zones actives 0 territoires 1 features 1 dans le Var 0 territoires: Territoire Croutoy chasse
```

**CynePortail** (1 appel) :

```
lots 684 communes 202 circonscriptions 16
emprise lon 6.95 8.23 lat 48.12 49.08
dates de battue 2026-11-17 → 2027-01-04
lots dans le Var : 0
battues le 2026-11-17 : 3 lots, ex. GRANDFONTAINE / GRANDFONTAINE - DONON LOT 10, PETERSBACH / PETERSBACH, STRUTH / STRUTH
```

Schéma d'un lot : `{ CODE_LOT, name, no_lot, commune, commune_id, circonscription, battue_count, battue_dates: [AAAA-MM-JJ…], battues: [{from,to}] }` + géométrie `Polygon`. Directement intersectable avec une trace figée (même mécanique que les massifs, `src/lib/fire/`).

## Recommandation

1. **Var : ne pas intégrer de source de battues déclarées.** Garder le « minimum garanti » (arrêtés, #1354) et le message de prudence. Ne jamais afficher « pas de battue ».
2. **Si on veut une vraie donnée pour le Var**, il faut qu'une fédération la publie. Le plus réaliste : **écrire à la FDC 83** (brouillon ci-dessous). Sinon, **suivre Ça chasse ?** (1 appel `GET /api/today`, compter `activeTerritories`) et rouvrir #1469 quand des territoires du Var apparaissent.
3. **CynePortail est la meilleure source technique** (polygones par lot, dates futures, JSON simple) : si l'instance un jour couvre l'Alsace (`SYNC_ZONES`), c'est la source à demander à l'éditeur. Son format est celui de #1469 en mieux. Aucune licence : autorisation écrite requise avant toute intégration.
4. Rien à intégrer maintenant : pas de ticket de code. Ticket `[Humain]` créé pour décider de l'envoi des mails.

### Brouillon de mail — FDC 83 (Var)

> Objet : Publication des jours de battue du Var pour les usagers (VTT, randonnée)
>
> Bonjour,
> Je développe une petite application libre d'organisation de sorties VTT dans le Var. Les pratiquants souhaiteraient savoir si une battue est prévue sur leur parcours le jour de la sortie. Nous avons constaté qu'aucune source publique de battues déclarées ne couvre le Var (Ça chasse ?, CynePortail et d'autres ne couvrent pas le département).
> La fédération prévoit-elle de publier les battues déclarées par les sociétés de chasse (carte, calendrier, ou flux de données) ? Si oui, accepteriez-vous leur réutilisation, avec mention de la source et sans surcharge de vos serveurs (quelques appels par jour) ? Je peux aussi vous renseigner sur l'outil libre ChassOuverte (déployé par la fédération du Jura).
> Cordialement,

### Brouillon de mail — CynePortail (si l'Alsace devient pertinente)

> Objet : Réutilisation du flux des battues (carte des battues, Bas-Rhin)
>
> Bonjour,
> Nous affichons des conditions de sortie (météo, incendie) pour des pratiquants de VTT. Votre carte des battues alimentée par `/declarations/timeline/geojson` nous intéresserait pour avertir les participants d'une sortie. Autorisez-vous sa réutilisation (appel serveur à la demande, cache d'une heure, source citée, lien vers votre carte) ? Quelles conditions d'usage souhaitez-vous ? Merci de nous indiquer aussi si une API officielle existe.
> Cordialement,

## Limites de l'étude

- Chassé & Croisé, Info Battue et les applis locales n'ont **pas** été testés techniquement (applis mobiles ou JS sans endpoint repéré) ; la couverture du Var de Chassé & Croisé vient de l'étude #1354.
- Les calendriers ONF n'ont pas été cherchés forêt par forêt pour le Var.
- Un jeu de données de 30 jours (CynePortail) et un seul jour par appel (Ça chasse ?) : la couverture évolue, à re-tester avant toute décision.
- Aucune donnée brute commitée : seuls les extraits ci-dessus.
