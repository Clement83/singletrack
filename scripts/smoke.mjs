// Test de fumée (#1482) : l'application démarrée répond. Sans dépendance, juste `fetch`.
//   SMOKE_URL=http://localhost:3000 SMOKE_SLUG=<slug d'une trace publique> node scripts/smoke.mjs
const base = (process.env.SMOKE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const slug = process.env.SMOKE_SLUG;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name} : ${e.message}`);
  }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });

// Attend le démarrage (jusqu'à 60 s).
for (let i = 0; i < 60; i++) {
  if (await get('/api/health').then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 1000));
}

await check('/api/health → 200 {status: ok}', async () => {
  const r = await get('/api/health');
  ok(r.status === 200, `statut ${r.status}`);
  ok((await r.json()).status === 'ok', 'corps inattendu');
});
await check('/login en français', async () => {
  const r = await get('/login', { 'accept-language': 'fr-FR,fr;q=0.9' });
  const html = await r.text();
  ok(r.status === 200, `statut ${r.status}`);
  ok(html.includes('Recevoir mon code'), 'texte français absent');
});
await check('/login en anglais', async () => {
  const r = await get('/login', { 'accept-language': 'en-US,en;q=0.9' });
  const html = await r.text();
  ok(r.status === 200, `statut ${r.status}`);
  ok(html.includes('Send me a code'), 'texte anglais absent');
});
await check('page privée sans session → redirection /login', async () => {
  const r = await get('/new');
  ok(r.status === 307 && new URL(r.headers.get('location'), base).pathname === '/login', `statut ${r.status}`);
});
await check('API privée sans session → 401', async () => {
  ok((await get('/api/tracks')).status === 401, 'pas de 401');
});
if (slug) {
  // Since #1593 /t/<slug> redirects to the map with the track open in the panel (/?t=<slug>).
  await check('/t/<slug> publique → carte avec la trace ouverte', async () => {
    const r = await get(`/t/${slug}`);
    const to = new URL(r.headers.get('location') ?? '', base);
    ok([307, 308].includes(r.status), `statut ${r.status}`);
    ok(to.pathname === '/' && to.searchParams.get('t') === slug, `redirection vers ${to.pathname}${to.search}`);
  });
  await check('carte publique / rendue sans compte', async () => {
    const r = await get(`/?t=${slug}`);
    ok(r.status === 200, `statut ${r.status}`);
  });
  await check('fiche de la trace (GET /api/tracks/<slug>) lisible sans compte', async () => {
    const r = await get(`/api/tracks/${slug}`);
    ok(r.status === 200, `statut ${r.status}`);
    ok((await r.json()).name === 'Boucle de fumée', 'nom de la trace absent');
  });
  await check('/api/t/<slug>/gpx téléchargeable', async () => {
    const r = await get(`/api/t/${slug}/gpx`);
    ok(r.status === 200 && (await r.text()).includes('<gpx'), `statut ${r.status}`);
  });
} else {
  console.log('skip /t/<slug> (SMOKE_SLUG absent)');
}
await check('/t/<inconnu> → 404', async () => {
  ok((await get('/t/00000000-0000-4000-8000-000000000000')).status === 404, 'pas de 404');
});

if (failed) { console.error(`${failed} vérification(s) en échec`); process.exit(1); }
console.log('Test de fumée réussi.');
