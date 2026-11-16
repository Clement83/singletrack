import { describe, it, expect } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { createContact, listContacts } from '@/lib/outings';
import {
  createInviteLink, linkContact, listFriends, peekInvite, redeemInvite, removeFriendship, requestByEmail, respondToRequest,
} from '@/lib/friends';

function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([
    { id: 'a', name: 'Alice', email: 'a@x.fr' }, { id: 'b', name: 'Bob', email: 'b@x.fr' }, { id: 'c', name: 'Cléo', email: 'c@x.fr' },
  ]).run();
  return db;
}

describe('copains (#1432)', () => {
  it('demande par email → acceptation par le seul destinataire', () => {
    const db = setup();
    expect(requestByEmail(db, 'a', 'B@x.fr ').ok).toBe(true);
    const bob = listFriends(db, 'b');
    expect(bob.incoming.map((e) => e.name)).toEqual(['Alice']);
    expect(listFriends(db, 'a').outgoing.map((e) => e.name)).toEqual(['Bob']);
    expect(respondToRequest(db, 'a', bob.incoming[0].id, 'accept')).toEqual({ ok: false, error: 'not_found' });
    expect(respondToRequest(db, 'b', bob.incoming[0].id, 'accept').ok).toBe(true);
    expect(listFriends(db, 'a').friends.map((e) => e.name)).toEqual(['Bob']);
    expect(listFriends(db, 'b').friends.map((e) => e.name)).toEqual(['Alice']);
  });

  it('email inconnu : même réponse, rien créé ; email invalide et soi-même refusés', () => {
    const db = setup();
    expect(requestByEmail(db, 'a', 'inconnu@x.fr')).toEqual({ ok: true });
    expect(listFriends(db, 'a').outgoing).toEqual([]);
    expect(requestByEmail(db, 'a', 'nimporte')).toEqual({ ok: false, error: 'invalidEmail' });
    expect(requestByEmail(db, 'a', 'a@x.fr')).toEqual({ ok: false, error: 'selfFriend' });
  });

  it('une seule relation par paire ; demande croisée = acceptation', () => {
    const db = setup();
    requestByEmail(db, 'a', 'b@x.fr');
    requestByEmail(db, 'a', 'b@x.fr');
    expect(listFriends(db, 'a').outgoing).toHaveLength(1);
    requestByEmail(db, 'b', 'a@x.fr');
    expect(listFriends(db, 'a').friends).toHaveLength(1);
    expect(listFriends(db, 'a').outgoing).toHaveLength(0);
  });

  it('refuser supprime la demande ; retirer / annuler marche des deux côtés', () => {
    const db = setup();
    requestByEmail(db, 'a', 'b@x.fr');
    const id = listFriends(db, 'b').incoming[0].id;
    expect(respondToRequest(db, 'b', id, 'decline').ok).toBe(true);
    expect(listFriends(db, 'a').outgoing).toEqual([]);
    requestByEmail(db, 'a', 'c@x.fr');
    const out = listFriends(db, 'a').outgoing[0].id;
    expect(removeFriendship(db, 'b', out)).toEqual({ ok: false, error: 'not_found' });
    expect(removeFriendship(db, 'a', out).ok).toBe(true);
    requestByEmail(db, 'a', 'b@x.fr');
    respondToRequest(db, 'b', listFriends(db, 'b').incoming[0].id, 'accept');
    expect(removeFriendship(db, 'b', listFriends(db, 'b').friends[0].id).ok).toBe(true);
    expect(listFriends(db, 'a').friends).toEqual([]);
  });

  it('lien à usage unique : copains tout de suite, deuxième usage refusé, pas soi-même', () => {
    const db = setup();
    const { token } = createInviteLink(db, 'a');
    expect(peekInvite(db, token)?.inviterName).toBe('Alice');
    expect(redeemInvite(db, 'a', token)).toEqual({ ok: false, error: 'selfFriend' });
    expect(redeemInvite(db, 'b', token).ok).toBe(true);
    expect(listFriends(db, 'a').friends.map((e) => e.name)).toEqual(['Bob']);
    expect(redeemInvite(db, 'c', token)).toEqual({ ok: false, error: 'not_found' });
    expect(peekInvite(db, token)).toBeNull();
    expect(redeemInvite(db, 'c', 'faux')).toEqual({ ok: false, error: 'not_found' });
  });

  it('lien carnet ↔ compte : copain accepté seulement, un seul pote par copain, délié si on se retire', () => {
    const db = setup();
    const c1 = createContact(db, 'a', { name: 'Bobby' }); const c2 = createContact(db, 'a', { name: 'Autre' });
    if (!c1.ok || !c2.ok) throw new Error();
    expect(linkContact(db, 'a', c1.id, 'b')).toEqual({ ok: false, error: 'notFriend' });
    requestByEmail(db, 'a', 'b@x.fr');
    respondToRequest(db, 'b', listFriends(db, 'b').incoming[0].id, 'accept');
    expect(linkContact(db, 'a', c1.id, 'b').ok).toBe(true);
    expect(linkContact(db, 'a', c2.id, 'b')).toEqual({ ok: false, error: 'alreadyLinked' });
    expect(linkContact(db, 'b', c1.id, 'a')).toEqual({ ok: false, error: 'not_found' });
    expect(listContacts(db, 'a').find((c) => c.id === c1.id)?.userId).toBe('b');
    removeFriendship(db, 'a', listFriends(db, 'a').friends[0].id);
    expect(listContacts(db, 'a').find((c) => c.id === c1.id)?.userId).toBeNull();
  });
});
