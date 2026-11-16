import { describe, it, expect } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import {
  addComment, createInvitation, createOuting, deleteComment, editComment, getOwnedOuting, guestContext, listComments,
  organizerContext, revokeInvitation, setStatus,
} from '@/lib/outings';
import { linkify } from '@/lib/outings/linkify';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }, { id: 'u2', name: 'Autre', email: 'a@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: [[6.1, 43.2, 100], [6.11, 43.21, 180], [6.1, 43.2, 101]] }, raw: {},
  }, { enrich: false });
  const o = await createOuting(db, 'u1', { trackSlug: t.slug, title: 'Dimanche', date: '2099-05-10', time: '08:30' });
  if (!('slug' in o)) throw new Error('création');
  const julien = createInvitation(db, 'u1', o.slug, 'Julien');
  const marc = createInvitation(db, 'u1', o.slug, 'Marc');
  if (!julien.ok || !marc.ok) throw new Error('invitation');
  return { db, slug: o.slug, julien: julien.token, marc: marc.token, jId: julien.id };
}

describe('commentaires de sortie', () => {
  it('Julien et l’organisateur échangent ; l’auteur d’un invité vient de son lien', async () => {
    const { db, slug, julien, marc } = await setup();
    const j = guestContext(db, julien)!;
    const org = organizerContext(db, 'u1', slug)!;
    expect(addComment(db, j.outing, j.actor, 'Qui a une pompe ?').ok).toBe(true);
    expect(addComment(db, org.outing, org.actor, 'Moi !', new Date(Date.now() + 1000)).ok).toBe(true);
    const m = guestContext(db, marc)!;
    const seen = listComments(db, m.outing.id, m.actor);
    expect(seen.map((c) => [c.author, c.organizer, c.body])).toEqual([['Julien', false, 'Qui a une pompe ?'], ['', true, 'Moi !']]);
    expect(seen.every((c) => !c.mine && !c.canEdit && !c.canDelete)).toBe(true);
    const own = listComments(db, j.outing.id, j.actor);
    expect(own[0]).toMatchObject({ mine: true, canEdit: true, canDelete: true });
    expect(own[1]).toMatchObject({ mine: false, canDelete: false });
  });

  it('Marc ne peut ni modifier ni supprimer le message de Julien ; l’organisateur modère', async () => {
    const { db, slug, julien, marc } = await setup();
    const j = guestContext(db, julien)!;
    const m = guestContext(db, marc)!;
    const org = organizerContext(db, 'u1', slug)!;
    const r = addComment(db, j.outing, j.actor, 'Salut');
    if (!r.ok) throw new Error();
    expect(editComment(db, m.outing, m.actor, r.id, 'piraté')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(deleteComment(db, m.outing, m.actor, r.id)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(editComment(db, org.outing, org.actor, r.id, 'réécrit')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(editComment(db, j.outing, j.actor, r.id, 'Salut tous').ok).toBe(true);
    const after = listComments(db, j.outing.id, j.actor);
    expect(after[0]).toMatchObject({ body: 'Salut tous', edited: true });
    expect(deleteComment(db, org.outing, org.actor, r.id).ok).toBe(true);
    expect(listComments(db, j.outing.id, j.actor)).toEqual([]);
  });

  it('un autre organisateur n’a aucun accès ; un lien révoqué non plus', async () => {
    const { db, slug, julien, jId } = await setup();
    expect(organizerContext(db, 'u2', slug)).toBeUndefined();
    expect(guestContext(db, 'x'.repeat(30))).toBeUndefined();
    expect(revokeInvitation(db, 'u1', slug, jId).ok).toBe(true);
    expect(guestContext(db, julien)).toBeUndefined();
  });

  it('valide la longueur (1–1000) et fige le fil quand la sortie est annulée', async () => {
    const { db, slug, julien } = await setup();
    const j = guestContext(db, julien)!;
    expect(addComment(db, j.outing, j.actor, '   ')).toMatchObject({ ok: false, errors: { body: 'empty' } });
    expect(addComment(db, j.outing, j.actor, 'a'.repeat(1001))).toMatchObject({ ok: false, errors: { body: 'tooLong' } });
    expect(addComment(db, j.outing, j.actor, 42)).toMatchObject({ ok: false, error: 'invalid' });
    expect(addComment(db, j.outing, j.actor, 'a'.repeat(1000)).ok).toBe(true);
    setStatus(db, 'u1', slug, 'cancelled');
    const o = getOwnedOuting(db, 'u1', slug)!;
    expect(addComment(db, o, j.actor, 'trop tard')).toMatchObject({ ok: false, error: 'closed' });
  });

  it('le texte reste brut : <script> est conservé tel quel (échappé à l’affichage par React)', async () => {
    const { db, julien } = await setup();
    const j = guestContext(db, julien)!;
    addComment(db, j.outing, j.actor, '<script>alert(1)</script>');
    expect(listComments(db, j.outing.id, j.actor)[0].body).toBe('<script>alert(1)</script>');
    expect(linkify('<script>alert(1)</script>')).toEqual([{ text: '<script>alert(1)</script>' }]);
  });
});

describe('linkify', () => {
  it('rend les liens http(s) cliquables sans la ponctuation finale', () => {
    expect(linkify('Voir https://exemple.fr/a?b=1, puis ok.')).toEqual([
      { text: 'Voir ' }, { text: 'https://exemple.fr/a?b=1', href: 'https://exemple.fr/a?b=1' }, { text: ', puis ok.' },
    ]);
  });
  it('ignore javascript: et les autres schémas', () => {
    expect(linkify('javascript:alert(1) ftp://x')).toEqual([{ text: 'javascript:alert(1) ftp://x' }]);
  });
});
