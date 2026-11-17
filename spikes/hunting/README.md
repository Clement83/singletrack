# spikes/hunting — extractions jetables (#1572)

Scripts de l'étude [`docs/hunting-sources.md`](../../docs/hunting-sources.md). **Pas de code de l'app** : exclus de tsc, ESLint et de l'image. Dérogation « scraping » valable pour ce POC seulement.

```bash
docker run --rm -v "$PWD/spikes/hunting:/s:ro" -w /s node:22-alpine node ca-chasse.mjs
docker run --rm -v "$PWD/spikes/hunting:/s:ro" -w /s node:22-alpine node cyneportail.mjs [AAAA-MM-JJ]
```

Sobriété : UA générique, ≥ 1,5 s entre appels, 3 appels (Ça chasse ?) et 1 appel (CynePortail). Rien n'est écrit sur disque : ne jamais commiter de données brutes.
