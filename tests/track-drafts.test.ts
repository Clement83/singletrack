import { describe, expect, it } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { createOuting } from '@/lib/outings';
import {
  canViewTrack, createEditedTrack, deleteTrack, findDuplicates, getTrackBySlug, getVisibleTrack, queryTracks, updateEditedTrack, upsertTrack, type EditorInput,
} from '@/lib/tracks';
import type { Position } from '@/lib/geo';

// Brouillons de trace enregistrés automatiquement (#1450).
const NO_IGN = { enrich: false } as const;
function setup() {
  const { db } = openDb(':memory:');
  const now = new Date();
  for (const id of ['u', 'v']) db.insert(user).values({ id, name: id, email: `${id}@x.fr`, emailVerified: true, createdAt: now, updatedAt: now }).run();
  return db;
}
const coords: Position[] = Array.from({ length: 30 }, (_, i) => [6.14 + i * 0.001, 43.22 + (i % 3) * 0.0005, 100 + i * 2] as Position);
const input = (over: Partial<EditorInput> = {}): EditorInput => ({
  name: 'Ma boucle', description: '', geometry: { type: 'LineString', coordinates: coords },
  waypoints: [[6.14, 43.22], [6.17, 43.22]], modes: ['route'], ...over,
});
const draftInput = (over: Partial<EditorInput> = {}) => input({ name: '', status: 'draft', ...over });
// Premier tronçon : quelques dizaines de mètres seulement.
const tiny: EditorInput = draftInput({ geometry: { type: 'LineString', coordinates: [[6.14, 43.22], [6.1402, 43.2201]] } });

async function draft(db: ReturnType<typeof setup>, over: Partial<EditorInput> = {}) {
  const r = await createEditedTrack(db, 'u', draftInput(over), NO_IGN);
  if (!('slug' in r)) throw new Error('refusé');
  return r.slug;
}

describe('brouillons', () => {
  it('un brouillon s’enregistre sans nom et dès le premier tronçon, une publication non', async () => {
    const db = setup();
    const r = await createEditedTrack(db, 'u', tiny, NO_IGN);
    if (!('slug' in r)) throw new Error('refusé');
    expect(getTrackBySlug(db, r.slug)).toMatchObject({ status: 'draft', name: '', source: 'manual', createdBy: 'u' });
    expect(await createEditedTrack(db, 'u', input({ name: '' }), NO_IGN)).toEqual({ errors: { name: 'nameRequired' } });
    expect(await createEditedTrack(db, 'u', { ...tiny, status: 'published', name: 'x' }, NO_IGN)).toEqual({ errors: { geometry: 'geometryTooShort' } });
    // Sans statut : publiée (compatibilité avec l'ancien client).
    const p = await createEditedTrack(db, 'u', input(), NO_IGN);
    if (!('slug' in p)) throw new Error('refusé');
    expect(getTrackBySlug(db, p.slug)!.status).toBe('published');
  });

  it('chaque autosave met à jour le même brouillon en place (slug stable)', async () => {
    const db = setup();
    const slug = await draft(db);
    const r = await updateEditedTrack(db, 'u', slug, draftInput({ description: 'v2' }), NO_IGN);
    expect(r).toEqual({ slug });
    expect(getTrackBySlug(db, slug)).toMatchObject({ status: 'draft', description: 'v2' });
  });

  it('publier exige un nom puis bascule le statut ; une trace publiée ne redevient jamais brouillon', async () => {
    const db = setup();
    const slug = await draft(db);
    expect(await updateEditedTrack(db, 'u', slug, input({ name: ' ', status: 'published' }), NO_IGN)).toEqual({ errors: { name: 'nameRequired' } });
    expect(getTrackBySlug(db, slug)!.status).toBe('draft');
    expect(await updateEditedTrack(db, 'u', slug, input({ name: 'Boucle du col', status: 'published' }), NO_IGN)).toEqual({ slug });
    expect(getTrackBySlug(db, slug)).toMatchObject({ status: 'published', name: 'Boucle du col' });
    // Autosave d'une trace publiée : reste publiée, le nom reste exigé.
    await updateEditedTrack(db, 'u', slug, input({ name: 'Boucle du col', description: 'x', status: 'draft' }), NO_IGN);
    expect(getTrackBySlug(db, slug)!.status).toBe('published');
    expect(await updateEditedTrack(db, 'u', slug, input({ name: '', status: 'draft' }), NO_IGN)).toEqual({ errors: { name: 'nameRequired' } });
  });

  it('un brouillon n’est modifiable (et supprimable) que par son auteur', async () => {
    const db = setup();
    const slug = await draft(db);
    expect(await updateEditedTrack(db, 'v', slug, draftInput(), NO_IGN)).toEqual({ error: 'forbidden' });
    expect(deleteTrack(db, 'v', slug)).toEqual({ error: 'forbidden' });
    expect(deleteTrack(db, 'u', slug)).toEqual({ ok: true });
  });

  it('visible de son seul auteur : lien en 404 pour tout autre (fiche, GPX, KML, éditeur)', async () => {
    const db = setup();
    const slug = await draft(db);
    const t = getTrackBySlug(db, slug)!;
    expect(canViewTrack(db, t, 'u')).toBe(true);
    expect(canViewTrack(db, t, 'v')).toBe(false);
    expect(canViewTrack(db, t, null)).toBe(false);
    expect(getVisibleTrack(db, slug, 'u')?.slug).toBe(slug);
    expect(getVisibleTrack(db, slug, 'v')).toBeUndefined();
    expect(getVisibleTrack(db, slug, undefined)).toBeUndefined();
    const pub = await upsertTrack(db, { source: 'osm', externalId: 'r/1', name: 'OSM', geometry: t.geometry, raw: null }, NO_IGN);
    expect(getVisibleTrack(db, pub.slug, undefined)).toBeDefined();
  });

  it('absent de l’explorateur (même pour l’auteur), présent dans « Mes traces » avec son statut', async () => {
    const db = setup();
    const slug = await draft(db);
    await createEditedTrack(db, 'u', input({ name: 'Publiée' }), NO_IGN);
    const all = queryTracks(db, {}, undefined, { userId: 'u' }).tracks;
    expect(all.map((t) => t.name)).toEqual(['Publiée']);
    expect(queryTracks(db, {}, undefined, {}).total).toBe(1);
    const mine = queryTracks(db, { mine: true }, undefined, { userId: 'u' }).tracks;
    expect(mine.map((t) => [t.slug === slug ? 'draft' : 'pub', t.status]).sort()).toEqual([['draft', 'draft'], ['pub', 'published']]);
    expect(queryTracks(db, { mine: true }, undefined, { userId: 'v' }).tracks).toEqual([]);
  });

  it('ne sert pas à créer une sortie, même pour son auteur', async () => {
    const db = setup();
    const slug = await draft(db);
    const base = { trackSlug: slug, title: 'Dimanche', date: '2099-05-10', time: '08:30' };
    expect(await createOuting(db, 'u', base)).toEqual({ error: 'not_found' });
    await updateEditedTrack(db, 'u', slug, input({ status: 'published' }), NO_IGN);
    expect(await createOuting(db, 'u', base)).toHaveProperty('slug');
  });

  it('ne déclenche pas d’avertissement de doublon', async () => {
    const db = setup();
    const slug = await draft(db);
    expect(findDuplicates(db, getTrackBySlug(db, slug)!.geometry)).toEqual([]);
  });

  it('une copie d’une trace externe commence en brouillon sans toucher l’original', async () => {
    const db = setup();
    const o = await upsertTrack(db, { source: 'osm', externalId: 'r/2', name: 'Origine', attribution: '© OSM', geometry: { type: 'LineString', coordinates: coords }, raw: null }, NO_IGN);
    const r = await createEditedTrack(db, 'u', draftInput({ parentSlug: o.slug }), NO_IGN);
    if (!('slug' in r)) throw new Error('refusé');
    expect(getTrackBySlug(db, r.slug)).toMatchObject({ status: 'draft', source: 'edited', attribution: '© OSM' });
    expect(getTrackBySlug(db, o.slug)!.status).toBe('published');
  });
});
