# Sources for hunting days / driven hunts (study #1572)

Study of 2026-11-17, **without integration** (follow-up of #1354, #1469, #1488). Exception granted by the maintainer on 2026-11-16: extraction allowed for this proof of concept only; if a source fits, the maintainer asks the publisher for permission **before** any integration. Throwaway scripts: [`spikes/hunting/`](../spikes/hunting/).

## Conclusion

**No source of declared driven hunts ("battues") is usable in the Var today.** The only two technically clean sources (JSON with polygons, future dates) cover **a single territory in the Oise** (Ça chasse ?) and **the Bas-Rhin / Alsace bossue** (CynePortail). For the Var, the only official and complete information remains the **prefectoral orders** (already integrated by #1354, "guaranteed minimum").

Regions where data is usable: **Alsace (Bas-Rhin)**, through CynePortail (684 lots, ~3 weeks of upcoming hunts). Isère, Savoie, Hérault and Jura have local apps, not checked technically (see table).

## Sources

| # | Source | Coverage | Granularity | Dates | Access | robots / terms | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **Var prefectoral orders** (var.gouv.fr, FDC 83) | **The whole Var**, official | department (season, wild boar hunt periods) | whole season | PDF, once a year | public acts | **Already integrated** (#1354). No "hunt here today". |
| 2 | **CynePortail** (cyneportail.fr/declarations/timeline) | **Bas-Rhin**: 16 districts, 684 lots, 202 municipalities; extent lon 6.95–8.23 / lat 48.12–49.08. **0 lots in the Var.** | **hunting lot polygon** + municipality | future and past days over 30 days (17/11/2026 → 04/01/2027) | **same-origin JSON** `GET /declarations/timeline/geojson` (1 call, ~10 MB, no key) | robots.txt: nothing forbidden; no terms or licence found | Best technical data, **outside the Var** |
| 3 | **Ça chasse ?** (ca-chasse.com) | **1 territory**: Croutoy (Oise). 0 in the Var, D, D+30, D+60 | polygon per municipality | D to `maxDate` (~3 months) | JSON `GET /api/today?date=…` (browser UA required) | robots Allow; terms: "massive extraction, overload" forbidden, no licence | Good format, **no data**. To re-test (1 call). |
| 4 | **Chassé & Croisé** (FFRandonnée) | Mostly south-west (study #1354); Var not checked | hunt area | real time | mobile app, no public API found | paid "private" mode hides areas | Discarded |
| 5 | **Info Battue** (info-battue.lovable.app) | "France", hobby project, Google ads | map | ongoing / upcoming | JS app; no endpoint found in the served page (not dug further) | no terms found | Discarded (unknown reliability) |
| 6 | **FDC 83** (fdc83.com) | Var | — | — | WordPress site, orders as PDF; `/public.api/` and `*.json` disallowed by robots.txt | — | No hunt map published (the home page mentions "battue" only for regulations) |
| 7 | **ONF** (hunting calendars in state forests) | state forests, per forest (Fontainebleau, Fougères…). Var: not found | forest | hunting days of the season | **PDF** relayed by municipalities | public | No machine format; to check for the state forests of the Var |
| 8 | Local apps: **Chasse Info** (Isère), **Land Share** (Savoie), **Melckone** (Hérault), WeHunt (FDC 77), ChasseOnWeb (Wallonia) | the departments/countries concerned, **not the Var** | hunt areas | real time | app; not tested | — | Outside the Var, not tested |
| 9 | **ChassOuverte** (Jura) | Jura | — | — | free software, no public map | free | Ideal if FDC 83 adopted it one day |
| 10 | Town halls / hunting societies / ACCA / notice boards | local | municipality | variable | PDF, Panneau Pocket, posters | — | Impossible to aggregate |

All this data is **declarative and incomplete**: no source makes it possible to state "no hunting here".

## Actual extractions (2026-11-17, scripts in `spikes/hunting/`)

**Ça chasse ?** (3 calls, 1.5 s apart):

```
2026-11-17 zones actives 0 territoires 0 features 1 dans le Var 0 territoires: Territoire Croutoy chasse
2026-12-17 zones actives 0 territoires 0 features 1 dans le Var 0 territoires: Territoire Croutoy chasse
2027-01-16 zones actives 0 territoires 1 features 1 dans le Var 0 territoires: Territoire Croutoy chasse
```

**CynePortail** (1 call):

```
lots 684 communes 202 circonscriptions 16
emprise lon 6.95 8.23 lat 48.12 49.08
dates de battue 2026-11-17 → 2027-01-04
lots dans le Var : 0
battues le 2026-11-17 : 3 lots, ex. GRANDFONTAINE / GRANDFONTAINE - DONON LOT 10, PETERSBACH / PETERSBACH, STRUTH / STRUTH
```

Schema of a lot: `{ CODE_LOT, name, no_lot, commune, commune_id, circonscription, battue_count, battue_dates: [YYYY-MM-DD…], battues: [{from,to}] }` + `Polygon` geometry. Directly intersectable with a frozen track (same mechanism as the forest massifs, `src/lib/fire/`).

## Recommendation

1. **Var: do not integrate any source of declared hunts.** Keep the "guaranteed minimum" (orders, #1354) and the caution message. Never display "no hunt".
2. **To get real data for the Var**, a federation has to publish it. The most realistic path: **write to FDC 83** (draft below). Otherwise, **watch Ça chasse ?** (1 call `GET /api/today`, count `activeTerritories`) and reopen #1469 when territories in the Var appear.
3. **CynePortail is the best technical source** (polygons per lot, future dates, simple JSON): if an instance ever covers Alsace (`SYNC_ZONES`), this is the source to ask the publisher about. Its format is that of #1469, only better. No licence: written permission required before any integration.
4. Nothing to integrate now: no code ticket. A `[Humain]` ticket was created to decide whether to send the emails.

### Email draft — FDC 83 (Var)

Kept in French: it is addressed to a French federation.

> Objet : Publication des jours de battue du Var pour les usagers (VTT, randonnée)
>
> Bonjour,
> Je développe une petite application libre d'organisation de sorties VTT dans le Var. Les pratiquants souhaiteraient savoir si une battue est prévue sur leur parcours le jour de la sortie. Nous avons constaté qu'aucune source publique de battues déclarées ne couvre le Var (Ça chasse ?, CynePortail et d'autres ne couvrent pas le département).
> La fédération prévoit-elle de publier les battues déclarées par les sociétés de chasse (carte, calendrier, ou flux de données) ? Si oui, accepteriez-vous leur réutilisation, avec mention de la source et sans surcharge de vos serveurs (quelques appels par jour) ? Je peux aussi vous renseigner sur l'outil libre ChassOuverte (déployé par la fédération du Jura).
> Cordialement,

### Email draft — CynePortail (if Alsace becomes relevant)

Kept in French: it is addressed to a French publisher.

> Objet : Réutilisation du flux des battues (carte des battues, Bas-Rhin)
>
> Bonjour,
> Nous affichons des conditions de sortie (météo, incendie) pour des pratiquants de VTT. Votre carte des battues alimentée par `/declarations/timeline/geojson` nous intéresserait pour avertir les participants d'une sortie. Autorisez-vous sa réutilisation (appel serveur à la demande, cache d'une heure, source citée, lien vers votre carte) ? Quelles conditions d'usage souhaitez-vous ? Merci de nous indiquer aussi si une API officielle existe.
> Cordialement,

## Limits of the study

- Chassé & Croisé, Info Battue and the local apps were **not** tested technically (mobile apps or JS without a visible endpoint); the Var coverage of Chassé & Croisé comes from study #1354.
- ONF calendars were not searched forest by forest for the Var.
- One 30-day dataset (CynePortail) and a single day per call (Ça chasse ?): coverage changes, to be re-tested before any decision.
- No raw data committed: only the excerpts above.
