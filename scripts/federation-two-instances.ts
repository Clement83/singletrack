// Federation integration test (#1474): TWO `next dev` instances in this container (ports 3101 and 3102,
// separate databases and build folders). Instance 1 resolves through WebFinger then sends a signed `Follow` to
// instance 2, which checks the signature, fetches the remote actor and caches it. Then (#1775) a participant on instance 2
// sends his ridden track to the organiser's instance 1 through the app API: Create, Update, Delete over signed HTTP.
//   docker compose -f docker-compose.yml exec app-dev npx tsx scripts/federation-two-instances.ts
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// Next rewrites tsconfig.json (includes the build folders): it is restored at the end.
const tsconfigBackup = fs.readFileSync('tsconfig.json', 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fed2-'));
const KEY = Buffer.alloc(32, 5).toString('base64');
const PORTS = [3101, 3102];
const procs: ChildProcess[] = [];
const baseEnv = (i: number) => ({
  ...process.env,
  PORT: String(PORTS[i]),
  NEXT_DIST_DIR: `.next-fed${i + 1}`,
  DATABASE_URL: path.join(tmp, `app${i + 1}.db`),
  FEDERATION_DB: path.join(tmp, `federation${i + 1}.db`),
  FEDERATION: 'on',
  FEDERATION_DEV_HTTP: '1',
  FEDERATION_KEY_ENC: KEY,
  BETTER_AUTH_URL: `http://127.0.0.1:${PORTS[i]}`,
  AUTH_SECURE_COOKIES: 'false',
  FIRE_SCHEDULER: 'off',
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fail(msg: string): never {
  console.error('ÉCHEC :', msg);
  cleanup();
  process.exit(1);
}
function cleanup() {
  // `next dev` starts a child server: kill the whole process group, otherwise it keeps listening on the port.
  for (const p of procs) { try { process.kill(-p.pid!, 'SIGTERM'); } catch { p.kill('SIGTERM'); } }
  for (const i of [1, 2]) fs.rmSync(`.next-fed${i}`, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync('tsconfig.json', tsconfigBackup);
}

async function waitUp(port: number) {
  for (let i = 0; i < 120; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => null);
    if (r?.ok) return;
    await sleep(1000);
  }
  fail(`instance ${port} injoignable`);
}

async function main() {
  // Accounts: alice on instance 1, paul on instance 2 (created before start-up, in their database).
  for (const [i, name] of [[0, 'Alice'], [1, 'Paul']] as const) {
    const env = baseEnv(i);
    await new Promise<void>((res, rej) => {
      const p = spawn('npx', ['tsx', 'scripts/user.ts', 'create', '--email', `${name.toLowerCase()}@x.test`, '--name', name], { env, stdio: 'inherit' });
      p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`user:create ${name}`))));
    });
  }
  for (const i of [0, 1]) {
    const p = spawn('npx', ['next', 'dev', '-H', '127.0.0.1', '-p', String(PORTS[i])], { env: baseEnv(i), stdio: process.env.FED_DEBUG ? 'inherit' : 'ignore', detached: true });
    procs.push(p);
  }
  await Promise.all(PORTS.map(waitUp));

  const jrd = { accept: 'application/jrd+json' };
  const ap = { accept: 'application/activity+json' };
  // 1. WebFinger of paul@instance2, queried as instance 1 would.
  // First call: Next compiles the proxy and the federation on the fly, a transient 404 is possible.
  let wf = await fetch(`http://127.0.0.1:3102/.well-known/webfinger?resource=${encodeURIComponent('acct:paul@127.0.0.1:3102')}`, { headers: jrd });
  for (let i = 0; i < 20 && wf.status !== 200; i++) {
    await sleep(1500);
    wf = await fetch(`http://127.0.0.1:3102/.well-known/webfinger?resource=${encodeURIComponent('acct:paul@127.0.0.1:3102')}`, { headers: jrd });
  }
  if (wf.status !== 200) fail(`WebFinger ${wf.status}`);
  const self = ((await wf.json()) as { links: { rel: string; href: string }[] }).links.find((l) => l.rel === 'self')!.href;
  if (self !== 'http://127.0.0.1:3102/ap/users/paul') fail(`lien self inattendu ${self}`);
  const actor = (await (await fetch(self, { headers: ap })).json()) as Record<string, unknown>;
  if (actor.preferredUsername !== 'paul' || JSON.stringify(actor).includes('@x.test')) fail('invalid actor or email exposed');
  console.log('OK WebFinger + acteur');

  // 2. Instance 1 sends paul a friend request (signed Follow, alice's keys encrypted in database 1); the SQLite queue delivers it.
  process.env.DATABASE_URL = baseEnv(0).DATABASE_URL;
  process.env.FEDERATION_DB = baseEnv(0).FEDERATION_DB;
  process.env.FEDERATION_KEY_ENC = KEY;
  process.env.FEDERATION_DEV_HTTP = '1';
  process.env.FEDERATION = 'on';
  process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3101';
  // 2 bis (#1475). Real WebFinger resolution + Follow signed through the queue: alice asks `paul@127.0.0.1:3102` (friends across servers).
  const { getDb } = await import('../src/db');
  const { getFederation } = await import('../src/lib/federation');
  const { requestByAddress } = await import('../src/lib/federation/friends');
  getFederation();
  const { db: db1 } = getDb();
  const aliceId = (db1.$client.prepare("select id from user where handle = 'alice'").get() as { id: string }).id;
  const asked = await requestByAddress(db1, aliceId, 'paul@127.0.0.1:3102');
  if (!asked.ok) fail(`requestByAddress : ${asked.error}`);
  const { resolveWithFedify } = await import('../src/lib/federation/friends');
  const r = await resolveWithFedify({ handle: 'paul', domain: '127.0.0.1:3102' });
  if (!r) fail('cannot resolve paul@127.0.0.1:3102');
  const known = await requestByAddress(db1, aliceId, 'zorro@127.0.0.1:3102');
  if (!known.ok) fail('address not found: neutral answer expected');

  // 3. Instance 2 checked the signature (actor 1 fetched over HTTP) and cached alice.
  const db2 = new Database(baseEnv(1).DATABASE_URL, { readonly: true });
  for (let i = 0; i < 40; i++) {
    const row = db2.prepare('select handle, domain, display_name, public_key_pem from remote_actor').get() as { handle: string; domain: string; display_name: string; public_key_pem: string } | undefined;
    const fr = db2.prepare('select status, requester_id, addressee_id, remote_actor_id from friendship').all() as { status: string; requester_id: string | null; addressee_id: string | null; remote_actor_id: string | null }[];
    if (row) {
      if (row.handle !== 'alice' || row.domain !== '127.0.0.1:3101' || !row.public_key_pem?.includes('PUBLIC KEY')) fail(`cache inattendu ${JSON.stringify(row)}`);
      if (fr.length !== 1 || fr[0].status !== 'pending' || fr[0].requester_id !== null || !fr[0].addressee_id || !fr[0].remote_actor_id) { await sleep(500); continue; }
      console.log('OK signed Follow received and verified; remote_actor:', row.handle, row.domain, '; friend request pending on paul\'s side');
      db2.close();
      await rides(db1, aliceId);
      cleanup();
      process.exit(0);
    }
    await sleep(500);
  }
  fail('no remote actor cached on instance 2 (Follow not received or signature rejected)');
}

/** A straight east-west GPX of `km` kilometres, a point every 50 m, starting at `lon0`. */
function gpxLine(km: number, lon0: number): string {
  const n = Math.round(km * 20) + 1;
  const pts = Array.from({ length: n }, (_, i) => `<trkpt lat="43.2" lon="${(lon0 + (i * 0.05) / 81.2).toFixed(6)}"></trkpt>`).join('');
  return `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}
async function poll<T>(what: string, fn: () => T | undefined | null | false, tries = 60): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = fn();
    if (v) return v;
    await sleep(500);
  }
  fail(what);
}

/**
 * #1775: paul (instance 2) joined alice's outing (instance 1) and sends his ridden track through the app API of HIS server.
 * Instance 2 checks instance 1's NodeInfo, sends a signed `Create(Document)`; instance 1 reads the track with a signed GET
 * (first and last 300 m already hidden), then `Update` replaces it and `Delete` removes it.
 */
async function rides(db1: import('../src/db').Db, aliceId: string) {
  const { outing, track } = await import('../src/db/schema');
  const { publishOuting } = await import('../src/lib/federation/outings');
  const { hashToken } = await import('../src/lib/outings/tokens');
  const { haversine } = await import('../src/lib/geo');
  const { randomUUID } = await import('node:crypto');
  const d2 = new Database(baseEnv(1).DATABASE_URL);
  const raw1 = db1.$client;

  // Friendship both ways (the Follow handshake itself is covered above), so that the public outing reaches paul's server.
  raw1.prepare("update friendship set status = 'accepted'").run();
  d2.prepare("update friendship set status = 'accepted'").run();
  const paulOn1 = raw1.prepare("select id from remote_actor where handle = 'paul'").get() as { id: string };

  // Alice's public outing, started an hour ago (created through SQL: the API refuses a past date).
  const now = Date.now();
  const trackId = randomUUID();
  const coords = Array.from({ length: 10 }, (_, i) => [6.1 + i * 0.003, 43.2, 100]);
  const geometry = { type: 'LineString', coordinates: coords };
  db1.insert(track).values({
    id: trackId, slug: randomUUID(), source: 'manual', name: 'Boucle', geometry, bboxMinLon: 6.1, bboxMinLat: 43.2, bboxMaxLon: 6.127, bboxMaxLat: 43.2, startLon: 6.1, startLat: 43.2,
    distanceM: 2200, createdBy: aliceId,
  } as never).run();
  const outingId = randomUUID();
  db1.insert(outing).values({
    id: outingId, slug: randomUUID(), trackId, ownerId: aliceId, createdBy: aliceId, title: 'Boucle fédérée', startsAt: new Date(now - 3600_000),
    meetingLat: 43.2, meetingLon: 6.1, visibility: 'public',
    trackSnapshot: { slug: '', name: 'Boucle', geometry, bbox: [6.1, 43.2, 6.127, 43.2], start: [6.1, 43.2], distanceM: 2200, elevationGainM: null, elevationLossM: null, minEle: null, maxEle: null, difficulty: null, loop: false, source: 'manual', license: null, attribution: null, author: null, sourceUrl: null, takenAt: new Date().toISOString() },
  } as never).run();
  await publishOuting(db1, outingId, 'Create');
  const remote = await poll('outing not received on instance 2', () => d2.prepare('select id from remote_outing where object_url like ?').get(`%/ap/outings/${outingId}`) as { id: string } | undefined);
  console.log('OK public outing received by instance 2');

  // Paul joined (answer stored on both sides: the Join round trip is covered by tests/federation-outings.test.ts).
  const paulId = (d2.prepare("select id from user where handle = 'paul'").get() as { id: string }).id;
  d2.prepare("insert into remote_response (remote_outing_id, user_id, answer, state, updated_at) values (?, ?, 'yes', 'accepted', ?)").run(remote.id, paulId, Math.floor(now / 1000));
  raw1.prepare("insert into invitation (id, outing_id, token_hash, remote_actor_id, name, origin, status, created_at, updated_at) values (?, ?, ?, ?, 'paul', 'remote', 'yes', ?, ?)")
    .run(randomUUID(), outingId, hashToken(randomUUID()), paulOn1.id, Math.floor(now / 1000), Math.floor(now / 1000));
  const token = randomUUID() + randomUUID();
  d2.prepare('insert into app_token (id, user_id, token_hash, device_name, created_at) values (?, ?, ?, ?, ?)').run(randomUUID(), paulId, hashToken(token), 'test', Math.floor(now / 1000));

  const send = async (method: 'POST' | 'DELETE', xml?: string) => {
    let body: FormData | undefined;
    if (xml) { body = new FormData(); body.append('file', new File([xml], 'ride.gpx')); }
    const r = await fetch(`http://127.0.0.1:3102/api/app/outings/${remote.id}/ride`, { method, body, headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const rideOn1 = () => raw1.prepare('select remote_url, distance_m, geometry from outing_ride where outing_id = ?').get(outingId) as { remote_url: string; distance_m: number; geometry: string } | undefined;

  // NodeInfo of the organiser's server announces the feature (first call may hit a transient 404 while Next compiles).
  let ni: { metadata?: { features?: string[] } } | null = null;
  for (let i = 0; i < 20 && !ni?.metadata; i++) {
    const r = await fetch('http://127.0.0.1:3101/nodeinfo/2.1', { headers: { accept: 'application/json' } });
    ni = r.ok ? await r.json() : null;
    if (!ni?.metadata) await sleep(1500);
  }
  if (!ni?.metadata?.features?.includes('singletrack:rides')) fail(`NodeInfo does not announce singletrack:rides: ${JSON.stringify(ni)}`);
  console.log('OK NodeInfo announces singletrack:rides');

  // Create.
  const first = await send('POST', gpxLine(3, 6.1));
  if (first.status !== 201 || first.json.federated !== 'sent') fail(`ride upload on instance 2: ${first.status} ${JSON.stringify(first.json)}`);
  const got = await poll('ride not received by the organiser (instance 1)', () => rideOn1());
  if (!got.remote_url.startsWith('http://127.0.0.1:3102/ap/rides/')) fail(`unexpected remote_url ${got.remote_url}`);
  const start = (JSON.parse(got.geometry) as { coordinates: number[][] }).coordinates[0];
  const gap = haversine([6.1, 43.2], start as [number, number]);
  if (gap < 290 || gap > 310) fail(`first 300 m not hidden on the organiser's side (gap ${gap.toFixed(0)} m)`);
  console.log(`OK Create: ride stored by the organiser, start hidden (${gap.toFixed(0)} m cut), ${got.distance_m} m`);
  // The ride document is never served without the organiser's signature.
  const anon = await fetch(got.remote_url, { headers: { accept: 'application/activity+json' } });
  if (anon.status !== 404 && anon.status !== 401) fail(`unsigned GET of the ride answered ${anon.status}`);
  console.log('OK unsigned GET of the ride refused:', anon.status);

  // Update.
  const second = await send('POST', gpxLine(5, 6.2));
  if (second.status !== 201 || second.json.federated !== 'sent') fail(`second upload: ${second.status} ${JSON.stringify(second.json)}`);
  await poll('Update not applied on instance 1', () => { const r = rideOn1(); return r && Math.abs(r.distance_m - 5000) < 100 ? r : undefined; });
  if ((raw1.prepare('select count(*) n from outing_ride where outing_id = ?').get(outingId) as { n: number }).n !== 1) fail('Update created a second ride');
  console.log('OK Update: ride replaced');

  // Delete.
  const del = await send('DELETE');
  if (del.status !== 200) fail(`delete: ${del.status}`);
  await poll('Delete not applied on instance 1', () => !rideOn1());
  console.log('OK Delete: ride removed on the organiser\'s side');
  d2.close();
}
main().catch((e) => fail(String(e)));
