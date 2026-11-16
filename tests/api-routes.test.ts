import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '@/db';
import { outing, user } from '@/db/schema';
import { createEditedTrack, upsertTrack, type EditorInput } from '@/lib/tracks';
import { createOuting, createInvitation } from '@/lib/outings';
import type { Position } from '@/lib/geo';

// Route handlers appelés directement, base SQLite en mémoire (#1482).
const st = vi.hoisted(() => ({ h: undefined as unknown, db: undefined as unknown, uid: null as string | null }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => st.h }));
vi.mock('@/lib/current-user', () => {
  class UnauthorizedError extends Error {}
  const getCurrentUser = async () => (st.uid ? { id: st.uid } : null);
  return {
    UnauthorizedError,
    getCurrentUser,
    assertUser: async () => { const u = await getCurrentUser(); if (!u) throw new UnauthorizedError(); return u; },
    unauthorized: (e: unknown) => {
      if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: 401 });
      throw e;
    },
  };
});
vi.mock('@/lib/geo', async (orig) => ({ ...(await orig<typeof import('@/lib/geo')>()), enrichElevation: async (g: unknown) => g }));

import * as outingsCollection from '@/app/api/outings/route';
import * as outingRoute from '@/app/api/outings/[slug]/route';
import * as outingJoin from '@/app/api/outings/[slug]/join/route';
import * as trackRoute from '@/app/api/tracks/[slug]/route';
import * as tracksList from '@/app/api/tracks/route';
import * as trackGeometry from '@/app/api/tracks/geometry/route';
import * as trackImport from '@/app/api/tracks/import/route';
import * as trackGpx from '@/app/api/t/[slug]/gpx/route';
import * as trackKml from '@/app/api/t/[slug]/kml/route';
import * as guestRespond from '@/app/api/i/[token]/route';
import * as guestPhotos from '@/app/api/i/[token]/photos/route';
import * as outingPhotos from '@/app/api/outings/[slug]/photos/route';
import * as outingComments from '@/app/api/outings/[slug]/comments/route';
import * as health from '@/app/api/health/route';
import * as locale from '@/app/api/locale/route';

const ctx = (slug: string) => ({ params: Promise.resolve({ slug, token: slug }) });
const json = (method: string, body: unknown) =>
  new Request('http://x/api', { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const coords: Position[] = Array.from({ length: 30 }, (_, i) => [6.14 + i * 0.001, 43.22 + (i % 3) * 0.0005, 100 + i * 2] as Position);
const draftInput: EditorInput = { name: '', status: 'draft', description: '', geometry: { type: 'LineString', coordinates: coords }, waypoints: [[6.14, 43.22], [6.17, 43.22]], modes: ['route'] };

let trackSlug: string, draftSlug: string, outingSlug: string, theirTrack: string;

beforeEach(async () => {
  const h = openDb(':memory:');
  const { db } = h;
  st.h = h; st.db = db; st.uid = 'a';
  const now = new Date();
  for (const id of ['a', 'b']) db.insert(user).values({ id, name: id, email: `${id}@x.fr`, emailVerified: true, createdAt: now, updatedAt: now }).run();
  const mk = (id: string, ext: string) => upsertTrack(db, { source: 'osm', externalId: id, name: `T${ext}`, license: 'ODbL', attribution: '© OSM', geometry: { type: 'LineString', coordinates: coords }, raw: {}, createdBy: ext }, { enrich: false });
  trackSlug = (await mk('r1', 'a')).slug;
  theirTrack = (await mk('r2', 'b')).slug;
  const d = await createEditedTrack(db, 'a', draftInput, { enrich: false });
  draftSlug = (d as { slug: string }).slug;
  const o = await createOuting(db, 'a', { trackSlug, title: 'Sortie', date: '2030-05-10', time: '08:30', visibility: 'invite' });
  outingSlug = (o as { slug: string }).slug;
});

describe('/api/outings/[slug] PATCH', () => {
  it('400 sur JSON invalide, 400 sur action inconnue', async () => {
    expect((await outingRoute.PATCH(json('PATCH', 'pas du json'), ctx(outingSlug))).status).toBe(400);
    const r = await outingRoute.PATCH(json('PATCH', { action: 'nuke' }), ctx(outingSlug));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'unknownAction' });
  });
  it('404 pour un autre utilisateur, indiscernable d’une sortie inconnue', async () => {
    st.uid = 'b';
    const other = await outingRoute.PATCH(json('PATCH', { action: 'cancel' }), ctx(outingSlug));
    st.uid = 'a';
    const unknown = await outingRoute.PATCH(json('PATCH', { action: 'cancel' }), ctx('00000000-0000-4000-8000-000000000000'));
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual(await unknown.json());
    expect(unknown.status).toBe(404);
  });
  it('422 sur entrée invalide, 200 puis annulation par l’organisateur', async () => {
    const bad = await outingRoute.PATCH(json('PATCH', { action: 'update', title: '', date: 'hier' }), ctx(outingSlug));
    expect(bad.status).toBe(422);
    expect((await bad.json()).errors).toMatchObject({ title: 'title', date: 'date' });
    expect((await outingRoute.PATCH(json('PATCH', { action: 'update', title: 'Nouveau', date: '2030-06-01', time: '09:00' }), ctx(outingSlug))).status).toBe(200);
    expect((await outingRoute.PATCH(json('PATCH', { action: 'cancel' }), ctx(outingSlug))).status).toBe(200);
  });
});

describe('/api/outings/[slug]/join', () => {
  it('404 pour une sortie inconnue ou non visible (« invite » : jamais listée)', async () => {
    st.uid = 'b';
    expect((await outingJoin.POST(json('POST', {}), ctx('nope'))).status).toBe(404);
    expect((await outingJoin.POST(json('POST', {}), ctx(outingSlug))).status).toBe(404);
  });
});

describe('/api/tracks/[slug] PUT / DELETE', () => {
  it('403 sur la trace d’un autre, 403 sur une source externe, 404 inconnue', async () => {
    st.uid = 'b';
    expect((await trackRoute.DELETE(json('DELETE', {}), ctx(trackSlug))).status).toBe(403);
    st.uid = 'a';
    expect((await trackRoute.DELETE(json('DELETE', {}), ctx(theirTrack))).status).toBe(403);
    expect((await trackRoute.DELETE(json('DELETE', {}), ctx('inconnue'))).status).toBe(404);
  });
  it('PUT : 400 sur corps invalide, 403 sur la trace d’un autre, 404 inconnue', async () => {
    expect((await trackRoute.PUT(json('PUT', 'x'), ctx(draftSlug))).status).toBe(400);
    st.uid = 'b';
    expect((await trackRoute.PUT(json('PUT', draftInput), ctx(draftSlug))).status).toBe(403);
    st.uid = 'a';
    expect((await trackRoute.PUT(json('PUT', draftInput), ctx('inconnue'))).status).toBe(404);
  });
  it('un brouillon se supprime par son auteur', async () => {
    expect((await trackRoute.DELETE(json('DELETE', {}), ctx(draftSlug))).status).toBe(200);
  });
});

describe('/api/tracks starts + geometry (#1530)', () => {
  const get = (url: string, h: Record<string, string> = {}) => new Request(`http://x${url}`, { headers: h });
  it('starts=1 : objets légers sans géométrie, brouillon d’autrui exclu', async () => {
    const r = await tracksList.GET(get('/api/tracks?starts=1'));
    const b = await r.json();
    expect(b.count).toBe(2);
    for (const t of b.tracks) {
      expect(t.geometry).toBeUndefined();
      expect(t.bbox).toBeUndefined();
      expect(t.start).toHaveLength(2);
    }
  });
  it('geometry : renvoie la géométrie simplifiée, omet inconnus et brouillons d’autrui, ETag 304', async () => {
    const r = await trackGeometry.GET(get(`/api/tracks/geometry?slugs=${trackSlug},${draftSlug},inconnue&z=14`));
    const b = await r.json();
    expect(b.tracks.map((t: { slug: string }) => t.slug).sort()).toEqual([draftSlug, trackSlug].sort());
    expect(b.tracks[0].geometry.coordinates.length).toBeGreaterThan(1);
    const etag = r.headers.get('etag')!;
    expect((await trackGeometry.GET(get(`/api/tracks/geometry?slugs=${trackSlug},${draftSlug},inconnue&z=14`, { 'if-none-match': etag }))).status).toBe(304);
    st.uid = 'b';
    const o = await (await trackGeometry.GET(get(`/api/tracks/geometry?slugs=${trackSlug},${draftSlug}`))).json();
    expect(o.tracks.map((t: { slug: string }) => t.slug)).toEqual([trackSlug]);
  });
  it('geometry : 400 sans slugs ou zoom invalide', async () => {
    expect((await trackGeometry.GET(get('/api/tracks/geometry'))).status).toBe(400);
    expect((await trackGeometry.GET(get(`/api/tracks/geometry?slugs=${trackSlug}&z=abc`))).status).toBe(400);
  });
});

describe('brouillons (#1450) : jamais publics', () => {
  it('GPX/KML publics : 404 pour un brouillon, y compris pour un visiteur sans session et pour un autre compte', async () => {
    for (const uid of [null, 'b']) {
      st.uid = uid;
      expect((await trackGpx.GET(new Request('http://x'), ctx(draftSlug))).status, `gpx ${uid}`).toBe(404);
      expect((await trackKml.GET(new Request('http://x'), ctx(draftSlug))).status, `kml ${uid}`).toBe(404);
    }
  });
  it('GPX d’une trace publiée : 200 avec en-têtes noindex ; inconnue : 404', async () => {
    st.uid = null;
    const r = await trackGpx.GET(new Request('http://x'), ctx(trackSlug));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('gpx');
    expect(r.headers.get('x-robots-tag')).toBe('noindex');
    expect((await trackGpx.GET(new Request('http://x'), ctx('inconnue'))).status).toBe(404);
  });
  it('POST /api/outings refuse un brouillon comme trace de sortie', async () => {
    const { createOuting: c } = await import('@/lib/outings');
    expect(await c(st.db as never, 'a', { trackSlug: draftSlug, title: 'x', date: '2030-05-10', time: '08:30' })).toEqual({ error: 'not_found' });
  });
  it('POST /api/outings envoyé deux fois (double envoi du formulaire, #1520) : une seule sortie, même réponse', async () => {
    const count = () => (st.db as ReturnType<typeof openDb>['db']).select().from(outing).all().length;
    const body = { trackSlug, title: 'Double envoi', date: '2099-05-10', time: '08:30', visibility: 'invite' };
    const before = count();
    const r1 = await outingsCollection.POST(json('POST', body));
    const r2 = await outingsCollection.POST(json('POST', body));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await r2.json()).toEqual(await r1.json());
    expect(count()).toBe(before + 1);
  });
});

describe('/api/i/[token] (invité sans compte)', () => {
  it('404 jeton inconnu, 400 corps invalide', async () => {
    expect((await guestRespond.POST(json('POST', { status: 'yes', name: 'Léo' }), ctx('jeton-inconnu'))).status).toBe(404);
    expect((await guestRespond.POST(json('POST', 'x'), ctx('jeton-inconnu'))).status).toBe(400);
  });
  it('404 pour un jeton révoqué ; 422 sur réponse invalide', async () => {
    const inv = createInvitation(st.db as never, 'a', outingSlug, 'Léo');
    if (!inv.ok) throw new Error('inv');
    const token = (inv as unknown as { token: string }).token;
    expect(token).toBeTruthy();
    const bad = await guestRespond.POST(json('POST', { status: 'peut-être' }), ctx(token));
    expect([422, 400]).toContain(bad.status);
    expect((await guestRespond.POST(json('POST', { status: 'yes', name: 'Léo' }), ctx(token))).status).toBe(200);
  });
  it('photos invité : 404 jeton inconnu', async () => {
    st.uid = null;
    expect((await guestPhotos.GET(new Request('http://x'), ctx('inconnu'))).status).toBe(404);
  });
});

describe('photos et commentaires organisateur', () => {
  it('404 pour un autre compte ; envoi non image : 422 ; fichier trop gros déclaré : 413', async () => {
    st.uid = 'b';
    expect((await outingPhotos.GET(new Request('http://x'), ctx(outingSlug))).status).toBe(404);
    expect((await outingComments.GET(new Request('http://x'), ctx(outingSlug))).status).toBe(404);
    st.uid = 'a';
    const fd = new FormData(); fd.set('file', new File(['pas une image'], 'a.jpg', { type: 'image/jpeg' }));
    const r = await outingPhotos.POST(new Request('http://x/p', { method: 'POST', body: fd, headers: { 'x-forwarded-for': '10.9.9.1' } }), ctx(outingSlug));
    expect([422, 409]).toContain(r.status);
    const big = await outingPhotos.POST(new Request('http://x/p', { method: 'POST', body: fd, headers: { 'content-length': String(100 * 1024 * 1024), 'x-forwarded-for': '10.9.9.2' } }), ctx(outingSlug));
    expect(big.status).toBe(413);
    const none = await outingPhotos.POST(new Request('http://x/p', { method: 'POST', body: new FormData(), headers: { 'x-forwarded-for': '10.9.9.3' } }), ctx(outingSlug));
    expect([422, 409]).toContain(none.status);
  });
  it('commentaire : 422 corps vide, 201 puis lecture', async () => {
    const empty = await outingComments.POST(json('POST', { body: '  ' }), ctx(outingSlug));
    expect([422, 409]).toContain(empty.status);
    const ok = await outingComments.POST(json('POST', { body: 'Salut' }), ctx(outingSlug));
    expect([201, 409]).toContain(ok.status);
  });
});

describe('/api/tracks/import : fichiers malformés', () => {
  const post = (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return trackImport.POST(new Request('http://x/i', { method: 'POST', body: fd }));
  };
  const fx = (p: string) => fs.readFileSync(path.join(process.cwd(), 'tests/fixtures', p));

  it('aucun fichier : 400 noFile ; trop de fichiers : 400', async () => {
    expect((await post([])).status).toBe(400);
    const many = Array.from({ length: 11 }, (_, i) => new File(['x'], `${i}.gpx`));
    expect((await post(many)).status).toBe(400);
  });
  it('extension refusée, XML illisible, sans point, DOCTYPE, trop gros : un code par fichier, jamais d’exception', async () => {
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'gros.gpx');
    const res = await post([
      new File(['x'], 'a.txt'),
      new File(['<gpx><oups'], 'casse.gpx'),
      new File(['<?xml version="1.0"?><gpx version="1.1" creator="x"></gpx>'], 'vide.gpx'),
      new File(['<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x "y">]><gpx version="1.1" creator="x"><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>'], 'xxe.gpx'),
      huge,
      new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0])], 'faux.kmz'),
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    const codes = Object.fromEntries(body.errors.map((e: { file: string; error: string }) => [e.file, e.error]));
    expect(codes['a.txt']).toBe('notGpxExt');
    expect(codes['gros.gpx']).toBe('tooBig');
    expect(codes['xxe.gpx']).toBe('doctype');
    expect(codes['casse.gpx']).toBeTruthy();
    expect(codes['vide.gpx']).toBeTruthy();
    expect(codes['faux.kmz']).toBeTruthy();
  });
  it('KML malveillant (entités) refusé ; GPX valide accepté', async () => {
    const bad = await (await post([new File([fx('kml/malicieux.kml')], 'm.kml')])).json();
    expect(bad.items).toEqual([]);
    expect(bad.errors).toHaveLength(1);
    const ok = await (await post([new File([fx('gpx/utagawa-boucle-pierrefeu.gpx')], 'ok.gpx')])).json();
    expect(ok.errors).toEqual([]);
    expect(ok.items.length).toBeGreaterThan(0);
  });
  it('PUT : 400 corps invalide, 422 sans nom/géométrie', async () => {
    expect((await trackImport.PUT(json('PUT', 'x'))).status).toBe(400);
    expect((await trackImport.PUT(json('PUT', {}))).status).toBe(422);
  });
});

describe('/api/health et /api/locale', () => {
  it('health : 200 ok, 503 si la base casse', async () => {
    const ok = await health.GET();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: 'ok', version: expect.any(String) });
    (st.h as ReturnType<typeof openDb>).sqlite.close();
    expect((await health.GET()).status).toBe(503);
  });
  it('locale : refuse une langue inconnue', async () => {
    const r = await locale.POST(json('POST', { locale: 'xx' }));
    expect(r.status).toBe(400);
  });
});
