import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '@/db';
import { contact, user } from '@/db/schema';
import { changeHandle, ensureHandle, hasRemoteFriends } from '@/lib/federation/handle';
import { upsertRemoteActor } from '@/lib/federation/remote-actors';
import {
  followUrl, onAccept, onFollow, onReject, onUndoFollow, parseAddress, removeFederated, requestByAddress, respondFederated,
  type Deliver, type FedDeps, type Outbound,
} from '@/lib/federation/friends';
import { areFriends, linkContact, listFriends } from '@/lib/friends';
import { listInvitableFriends } from '@/lib/outings/friend-invites';

/** Deux « serveurs » en mémoire : l'envoi d'un serveur appelle directement les gestionnaires de l'autre (le réseau est testé par scripts/federation-two-instances.ts). */
type Server = { db: Db; domain: string; log: Outbound[] };
const servers: Record<string, Server> = {};
const actorUrl = (domain: string, handle: string) => `https://${domain}/ap/users/${handle}`;

function mk(domain: string, name: string, uid: string): Server {
  const { db } = openDb(':memory:');
  db.insert(user).values({ id: uid, name, email: `${uid}@x.test` }).run();
  ensureHandle(db, uid);
  return (servers[domain] = { db, domain, log: [] });
}

const deliverFrom = (from: Server): Deliver => async (handle, to, msg) => {
  from.log.push(msg);
  const url = new URL(to.actorUrl);
  const target = servers[url.host];
  const targetHandle = url.pathname.split('/').pop()!;
  const sender = upsertRemoteActor(target.db, { actorUrl: actorUrl(from.domain, handle), handle, displayName: handle, inboxUrl: `https://${from.domain}/ap/users/${handle}/inbox` });
  const deps = depsFor(target);
  if (msg.t === 'follow') await onFollow(target.db, sender.actorUrl, targetHandle, followUrl(msg.id), deps);
  else if (msg.t === 'accept') onAccept(target.db, sender.actorUrl, msg.followId);
  else if (msg.t === 'reject') onReject(target.db, sender.actorUrl, msg.followId);
  else await onUndoFollow(target.db, sender.actorUrl, targetHandle, deps);
};

const depsFor = (s: Server): FedDeps => ({
  resolve: async ({ handle, domain }) => (servers[domain] && handle !== 'zorro' ? { actorUrl: actorUrl(domain, handle), handle, displayName: handle, inboxUrl: `https://${domain}/ap/users/${handle}/inbox`, sharedInboxUrl: null } : null),
  deliver: deliverFrom(s),
});

let a: Server;
let b: Server;
beforeEach(() => {
  vi.stubEnv('FEDERATION', 'on');
  vi.stubEnv('BETTER_AUTH_URL', 'https://a.example');
  a = mk('a.example', 'Alice', 'ua');
  b = mk('b.example', 'Paul', 'up');
});
afterEach(() => { vi.unstubAllEnvs(); for (const k of Object.keys(servers)) delete servers[k]; });

describe('copains entre serveurs (#1475)', () => {
  it('parseAddress : paul@domaine, @paul@domaine, acct:, casse ; rejette le reste', () => {
    expect(parseAddress(' Paul@VTT.Example.fr ')).toEqual({ handle: 'paul', domain: 'vtt.example.fr' });
    expect(parseAddress('@paul@x.org')).toEqual({ handle: 'paul', domain: 'x.org' });
    expect(parseAddress('acct:paul@x.org:8080')?.domain).toBe('x.org:8080');
    for (const bad of ['paul', 'paul@', '@x.org', 'a b@x.org', 42, null]) expect(parseAddress(bad)).toBeNull();
  });

  it('cycle : demande (Follow) → acceptation (Accept + Follow en retour) → amis des deux côtés', async () => {
    expect(await requestByAddress(a.db, 'ua', 'paul@b.example', depsFor(a))).toEqual({ ok: true });
    expect(a.log.map((m) => m.t)).toEqual(['follow']);
    const out = listFriends(a.db, 'ua').outgoing;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userId: null, name: 'paul', remote: { handle: 'paul', domain: 'b.example' } });
    const inc = listFriends(b.db, 'up').incoming;
    expect(inc.map((e) => e.remote?.domain)).toEqual(['a.example']);
    // Seul le destinataire accepte.
    expect(await respondFederated(a.db, 'ua', out[0].id, 'accept', depsFor(a))).toEqual({ ok: false, error: 'not_found' });

    expect(await respondFederated(b.db, 'up', inc[0].id, 'accept', depsFor(b))).toEqual({ ok: true });
    expect(b.log.map((m) => m.t)).toEqual(['accept', 'follow']);
    expect(listFriends(a.db, 'ua').friends.map((f) => f.remote?.handle)).toEqual(['paul']);
    expect(listFriends(b.db, 'up').friends.map((f) => f.remote?.handle)).toEqual(['alice']);
    expect(listFriends(a.db, 'ua').outgoing).toEqual([]);
    // Le Follow de retour est confirmé par un Accept, sans rien changer.
    expect(a.log.map((m) => m.t)).toEqual(['follow', 'accept']);
  });

  it('adresse introuvable : même réponse, rien créé ; adresse invalide, soi-même et fédération coupée refusés', async () => {
    expect(await requestByAddress(a.db, 'ua', 'zorro@b.example', depsFor(a))).toEqual({ ok: true });
    expect(listFriends(a.db, 'ua').outgoing).toEqual([]);
    expect(a.log).toEqual([]);
    expect(await requestByAddress(a.db, 'ua', 'nimporte', depsFor(a))).toEqual({ ok: false, error: 'invalidAddress' });
    expect(await requestByAddress(a.db, 'ua', 'alice@a.example', depsFor(a))).toEqual({ ok: false, error: 'selfFriend' });
    vi.stubEnv('FEDERATION', 'off');
    expect(await requestByAddress(a.db, 'ua', 'paul@b.example', depsFor(a))).toEqual({ ok: false, error: 'federationOff' });
  });

  it('adresse de ce serveur : copain local, sans réseau', async () => {
    a.db.insert(user).values({ id: 'ub', name: 'Bob', email: 'bob@x.test' }).run();
    ensureHandle(a.db, 'ub');
    expect(await requestByAddress(a.db, 'ua', 'bob@a.example', depsFor(a))).toEqual({ ok: true });
    expect(listFriends(a.db, 'ub').incoming.map((e) => e.userId)).toEqual(['ua']);
    expect(a.log).toEqual([]);
  });

  it('refuser = Reject : la demande disparaît chez le demandeur', async () => {
    await requestByAddress(a.db, 'ua', 'paul@b.example', depsFor(a));
    await respondFederated(b.db, 'up', listFriends(b.db, 'up').incoming[0].id, 'decline', depsFor(b));
    expect(b.log.map((m) => m.t)).toEqual(['reject']);
    expect(listFriends(a.db, 'ua').outgoing).toEqual([]);
    expect(listFriends(b.db, 'up').incoming).toEqual([]);
  });

  it('annuler une demande envoyée = Undo(Follow) : disparaît des deux côtés', async () => {
    await requestByAddress(a.db, 'ua', 'paul@b.example', depsFor(a));
    expect(await removeFederated(a.db, 'ua', listFriends(a.db, 'ua').outgoing[0].id, depsFor(a))).toEqual({ ok: true });
    expect(a.log.map((m) => m.t)).toEqual(['follow', 'undo']);
    expect(listFriends(b.db, 'up').incoming).toEqual([]);
  });

  it('retirer un copain : Undo des deux côtés, carnet délié', async () => {
    await requestByAddress(a.db, 'ua', 'paul@b.example', depsFor(a));
    await respondFederated(b.db, 'up', listFriends(b.db, 'up').incoming[0].id, 'accept', depsFor(b));
    const f = listFriends(a.db, 'ua').friends[0];
    const c = a.db.insert(contact).values({ ownerUserId: 'ua', name: 'Paul' }).returning().get();
    expect(linkContact(a.db, 'ua', c.id, null, f.remote!.actorId)).toEqual({ ok: true });
    expect(a.db.select().from(contact).get()?.remoteActorId).toBe(f.remote!.actorId);

    // Retrait côté B (celui qui avait accepté) : Undo de son Follow de retour ; A répond par l'Undo du sien.
    b.log.length = 0; a.log.length = 0;
    expect(await removeFederated(b.db, 'up', listFriends(b.db, 'up').friends[0].id, depsFor(b))).toEqual({ ok: true });
    expect(b.log.map((m) => m.t)).toEqual(['undo']);
    expect(a.log.map((m) => m.t)).toEqual(['undo']);
    expect(listFriends(a.db, 'ua').friends).toEqual([]);
    expect(listFriends(b.db, 'up').friends).toEqual([]);
    expect(a.db.select().from(contact).get()?.remoteActorId).toBeNull();
  });

  it('demande croisée (chacun a demandé) = acceptation', async () => {
    // A demande, B n'a pas encore reçu : B demande aussi à A avant de voir la demande.
    await requestByAddress(a.db, 'ua', 'paul@b.example', depsFor(a));
    const inc = listFriends(b.db, 'up').incoming[0];
    expect(inc).toBeTruthy();
    // Côté B, une demande de B vers A alors qu'une demande de A est en attente vaut acceptation.
    vi.stubEnv('BETTER_AUTH_URL', 'https://b.example'); // le « serveur » qui agit est B
    expect(await requestByAddress(b.db, 'up', 'alice@a.example', depsFor(b))).toEqual({ ok: true });
    expect(listFriends(b.db, 'up').friends).toHaveLength(1);
    expect(listFriends(a.db, 'ua').friends).toHaveLength(1);
  });

  it('un Follow rejoué ne crée pas de doublon ; un Follow vers un handle inconnu est ignoré', async () => {
    await requestByAddress(a.db, 'ua', 'paul@b.example', depsFor(a));
    const sender = actorUrl('a.example', 'alice');
    await onFollow(b.db, sender, 'paul', followUrl('x'), depsFor(b));
    await onFollow(b.db, sender, 'inconnu', followUrl('y'), depsFor(b));
    expect(listFriends(b.db, 'up').incoming).toHaveLength(1);
  });

  it('un Accept / Undo d’un acteur étranger ou d’un Follow inconnu ne change rien', async () => {
    await requestByAddress(a.db, 'ua', 'paul@b.example', depsFor(a));
    const id = listFriends(a.db, 'ua').outgoing[0].id;
    upsertRemoteActor(a.db, { actorUrl: actorUrl('evil.example', 'paul'), handle: 'paul', inboxUrl: 'https://evil.example/i' });
    onAccept(a.db, actorUrl('evil.example', 'paul'), followUrl(id));
    onAccept(a.db, actorUrl('b.example', 'paul'), followUrl('inconnu'));
    expect(listFriends(a.db, 'ua').outgoing).toHaveLength(1);
    await onUndoFollow(a.db, actorUrl('evil.example', 'paul'), 'alice', depsFor(a));
    expect(listFriends(a.db, 'ua').outgoing).toHaveLength(1);
  });

  it('une seule notion de copain : liste, carnet, invitables, handle verrouillé', async () => {
    await requestByAddress(a.db, 'ua', 'paul@b.example', depsFor(a));
    expect(hasRemoteFriends(a.db, 'ua')).toBe(true);
    expect(changeHandle(a.db, 'ua', 'alice_vtt')).toEqual({ ok: false, error: 'remote_friends' });
    await respondFederated(b.db, 'up', listFriends(b.db, 'up').incoming[0].id, 'accept', depsFor(b));
    const f = listFriends(a.db, 'ua').friends[0];
    const c = a.db.insert(contact).values({ ownerUserId: 'ua', name: 'Paul' }).returning().get();
    expect(linkContact(a.db, 'ua', c.id, null, 'inconnu')).toEqual({ ok: false, error: 'notFriend' });
    expect(linkContact(a.db, 'ua', c.id, null, f.remote!.actorId)).toEqual({ ok: true });
    expect(linkContact(a.db, 'ua', c.id, null)).toEqual({ ok: true });
    expect(areFriends(a.db, 'ua', 'up')).toBe(false); // pas un compte local
    // Un copain distant n'a pas de compte local : il est proposé sous `remote:<acteur>` (invitation ActivityPub, #1476), pas en local.
    const o = { id: 'o', ownerId: 'ua', createdBy: 'ua', visibility: 'friends', participantsCanInvite: false, status: 'planned', startsAt: new Date(Date.now() + 864e5) } as never;
    expect(listInvitableFriends(a.db, 'ua', o)).toEqual([{ userId: `remote:${f.remote!.actorId}`, name: 'paul · b.example' }]);
  });
});
