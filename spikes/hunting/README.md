# spikes/hunting — throwaway extractions (#1572)

Scripts of the study [`docs/hunting-sources.md`](../../docs/hunting-sources.md). **Not application code**: excluded from tsc, ESLint and the image. The "scraping" exception applies to this proof of concept only.

```bash
docker run --rm -v "$PWD/spikes/hunting:/s:ro" -w /s node:22-alpine node ca-chasse.mjs
docker run --rm -v "$PWD/spikes/hunting:/s:ro" -w /s node:22-alpine node cyneportail.mjs [YYYY-MM-DD]
```

Restraint: generic UA, ≥ 1.5 s between calls, 3 calls (Ça chasse ?) and 1 call (CynePortail). Nothing is written to disk: never commit raw data.
