// Test d'intégration de la fédération (#1474) : DEUX instances `next dev` dans ce conteneur (ports 3101 et 3102,
// bases et dossiers de build séparés). L'instance 1 résout par WebFinger puis envoie un `Follow` signé à
// l'instance 2, qui vérifie la signature, récupère l'acteur distant et le met en cache.
//   docker compose exec app npx tsx scripts/federation-two-instances.ts
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// Next réécrit tsconfig.json (include des dossiers de build) : on le restaure à la fin.
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
  // `next dev` lance un serveur fils : on tue tout le groupe de processus, sinon il reste à écouter sur le port.
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
  // Comptes : alice sur l'instance 1, paul sur l'instance 2 (créés avant le démarrage, dans leur base).
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
  // 1. WebFinger de paul@instance2, interrogé comme le ferait l'instance 1.
  // Premier appel : Next compile le proxy et la fédération à la volée, un 404 transitoire est possible.
  let wf = await fetch(`http://127.0.0.1:3102/.well-known/webfinger?resource=${encodeURIComponent('acct:paul@127.0.0.1:3102')}`, { headers: jrd });
  for (let i = 0; i < 20 && wf.status !== 200; i++) {
    await sleep(1500);
    wf = await fetch(`http://127.0.0.1:3102/.well-known/webfinger?resource=${encodeURIComponent('acct:paul@127.0.0.1:3102')}`, { headers: jrd });
  }
  if (wf.status !== 200) fail(`WebFinger ${wf.status}`);
  const self = ((await wf.json()) as { links: { rel: string; href: string }[] }).links.find((l) => l.rel === 'self')!.href;
  if (self !== 'http://127.0.0.1:3102/ap/users/paul') fail(`lien self inattendu ${self}`);
  const actor = (await (await fetch(self, { headers: ap })).json()) as Record<string, unknown>;
  if (actor.preferredUsername !== 'paul' || JSON.stringify(actor).includes('@x.test')) fail('acteur invalide ou email exposé');
  console.log('OK WebFinger + acteur');

  // 2. L'instance 1 demande paul en copain (Follow signé, clés de alice chiffrées en base 1) ; la file SQLite l'achemine.
  process.env.DATABASE_URL = baseEnv(0).DATABASE_URL;
  process.env.FEDERATION_DB = baseEnv(0).FEDERATION_DB;
  process.env.FEDERATION_KEY_ENC = KEY;
  process.env.FEDERATION_DEV_HTTP = '1';
  process.env.FEDERATION = 'on';
  process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3101';
  // 2 bis (#1475). Vraie résolution WebFinger + Follow signé par la file : alice demande `paul@127.0.0.1:3102` (copains entre serveurs).
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
  if (!r) fail('résolution de paul@127.0.0.1:3102 impossible');
  const known = await requestByAddress(db1, aliceId, 'zorro@127.0.0.1:3102');
  if (!known.ok) fail('adresse introuvable : réponse neutre attendue');

  // 3. L'instance 2 a vérifié la signature (acteur 1 récupéré par HTTP) et mis alice en cache.
  const db2 = new Database(baseEnv(1).DATABASE_URL, { readonly: true });
  for (let i = 0; i < 40; i++) {
    const row = db2.prepare('select handle, domain, display_name, public_key_pem from remote_actor').get() as { handle: string; domain: string; display_name: string; public_key_pem: string } | undefined;
    const fr = db2.prepare('select status, requester_id, addressee_id, remote_actor_id from friendship').all() as { status: string; requester_id: string | null; addressee_id: string | null; remote_actor_id: string | null }[];
    if (row) {
      if (row.handle !== 'alice' || row.domain !== '127.0.0.1:3101' || !row.public_key_pem?.includes('PUBLIC KEY')) fail(`cache inattendu ${JSON.stringify(row)}`);
      if (fr.length !== 1 || fr[0].status !== 'pending' || fr[0].requester_id !== null || !fr[0].addressee_id || !fr[0].remote_actor_id) { await sleep(500); continue; }
      console.log('OK Follow signé reçu et vérifié ; remote_actor :', row.handle, row.domain, '; demande de copain en attente chez paul');
      db2.close();
      cleanup();
      process.exit(0);
    }
    await sleep(500);
  }
  fail('aucun acteur distant en cache côté instance 2 (Follow non reçu ou signature refusée)');
}
main().catch((e) => fail(String(e)));
