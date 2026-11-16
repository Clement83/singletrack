// Spike #1471 : Fedify sur SQLite, sans Redis ni Postgres. Jetable.
import { createFederation, generateCryptoKeyPair, exportJwk, importJwk } from '@fedify/fedify';
import { Person, Follow, Accept, Endpoints } from '@fedify/vocab';
import { SqliteKvStore, SqliteMessageQueue } from '@fedify/sqlite';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.SPIKE_DB ?? './spike.db');
export const received: string[] = [];
const g = globalThis as any;
if (!g.__fed) {
  const federation = createFederation<void>({
    kv: new SqliteKvStore(db),
    queue: new SqliteMessageQueue(db),
    // Drapeau de dev : accepte HTTP et adresses privées (réseau docker). En production : HTTPS obligatoire, drapeau absent.
    allowPrivateAddress: process.env.FEDERATION_DEV_HTTP === '1',
    origin: process.env.ORIGIN,
  });
  federation
    .setActorDispatcher('/ap/users/{identifier}', async (ctx, identifier) => {
      if (!['alice', 'paul'].includes(identifier)) return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      return new Person({
        id: ctx.getActorUri(identifier), preferredUsername: identifier, name: identifier,
        inbox: ctx.getInboxUri(identifier), endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
        publicKey: keys[0]?.cryptographicKey, assertionMethods: keys.map((k) => k.multikey),
      });
    })
    .mapHandle((_ctx, username) => (['alice', 'paul'].includes(username) ? username : null))
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      const row = db.prepare('select v from spike_keys where id=?').get(identifier) as { v: string } | undefined;
      if (row) { const j = JSON.parse(row.v); return [{ privateKey: await importJwk(j.priv, 'private'), publicKey: await importJwk(j.pub, 'public') }]; }
      const kp = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
      db.prepare('insert into spike_keys(id,v) values(?,?)').run(identifier, JSON.stringify({ priv: await exportJwk(kp.privateKey), pub: await exportJwk(kp.publicKey) }));
      return [kp];
    });
  federation.setInboxListeners('/ap/users/{identifier}/inbox', '/ap/inbox')
    .on(Follow, async (ctx, follow) => {
      try {
        const from = await follow.getActor(ctx);
        db.prepare('insert into spike_log(m) values(?)').run(`Follow de ${follow.actorId?.href} (signature vérifiée), acteur résolu : ${!!from}`);
        if (from && ctx.recipient) await ctx.sendActivity({ identifier: ctx.recipient }, from,
          new Accept({ id: new URL('/ap/accepts/' + crypto.randomUUID(), ctx.canonicalOrigin), actor: follow.objectId, object: follow }));
        db.prepare('insert into spike_log(m) values(?)').run('Accept envoyé');
      } catch (e) { db.prepare('insert into spike_log(m) values(?)').run('ERREUR ' + String(e).slice(0, 300)); }
    })
    .on(Accept, async (_c, a) => { db.prepare('insert into spike_log(m) values(?)').run(`Accept de ${a.actorId?.href}`); });
  db.exec('create table if not exists spike_keys(id text primary key, v text); create table if not exists spike_log(id integer primary key, m text)');
  federation.startQueue(undefined as any);
  g.__fed = federation;
}
export const federation = g.__fed as ReturnType<typeof createFederation<void>>;
export { db };
