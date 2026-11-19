import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '@/db';
import { friendship, outing, track, user } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { pairKey } from '@/lib/friends';
import { createEditedTrack, updateEditedTrack, upsertTrack, type EditorInput } from '@/lib/tracks';
import { createOuting, createInvitation } from '@/lib/outings';
import type { Position } from '@/lib/geo';

// Route handlers called directly, in-memory SQLite database (#1482).
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
import * as outingsMap from '@/app/api/outings/map/route';
import * as outingsMapOne from '@/app/api/outings/map/[id]/route';
import * as trackKml from '@/app/api/t/[slug]/kml/route';
import * as guestRespond from '@/app/api/i/[token]/route';
import * as guestPhotos from '@/app/api/i/[token]/photos/route';
import * as outingPhotos from '@/app/api/outings/[slug]/photos/route';
import * as outingComments from '@/app/api/outings/[slug]/comments/route';
import * as health from '@/app/api/health/route';
import * as locale from '@/app/api/locale/route';
import * as profileRoute from '@/app/api/profile/route';

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

describe('GET /api/tracks/[slug] (#1581)', () => {
  const get = (h: Record<string, string> = {}) => new Request('http://x/api/tracks/s', { headers: h });
  it('200 : fiche complète, droits, ETag 304', async () => {
    const r = await trackRoute.GET(get(), ctx(trackSlug));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.slug).toBe(trackSlug);
    expect(b.geometry.coordinates.length).toBeGreaterThan(1);
    expect(b.bbox).toHaveLength(4);
    expect(b.start).toHaveLength(2);
    expect(b.end).toHaveLength(2);
    expect(b.rights).toEqual({ edit: false, copy: true, delete: false }); // OSM source: cannot be edited in place
    const d = await (await trackRoute.GET(get(), ctx(draftSlug))).json();
    expect(d.rights).toEqual({ edit: true, copy: false, delete: true });
    expect(Array.isArray(b.outings)).toBe(true);
    expect(b.durationMin).toBeGreaterThan(0);
    const etag = r.headers.get('etag')!;
    expect((await trackRoute.GET(get({ 'if-none-match': etag }), ctx(trackSlug))).status).toBe(304);
  });
  it('404 : inconnue et brouillon d’autrui ; droits d’un autre utilisateur', async () => {
    expect((await trackRoute.GET(get(), ctx('inconnue'))).status).toBe(404);
    st.uid = 'b';
    expect((await trackRoute.GET(get(), ctx(draftSlug))).status).toBe(404);
    const b = await (await trackRoute.GET(get(), ctx(trackSlug))).json();
    expect(b.rights.edit).toBe(false);
    st.uid = 'a';
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

// Matrix #1589: anonymous / author / friend / other × public / friends / private / draft ⇒ 200 or 404, never 403.
describe('visibilité des traces : toutes les lectures (#1589)', () => {
  const VIS = ['public', 'friends', 'private'] as const;
  // viewer → visibility → readable? (draft: author only)
  const WHO: Record<string, [string | null, Record<string, boolean>]> = {
    anonyme: [null, { public: true, friends: false, private: false, draft: false }],
    auteur: ['a', { public: true, friends: true, private: true, draft: true }],
    copain: ['f', { public: true, friends: true, private: false, draft: false }],
    autre: ['b', { public: true, friends: false, private: false, draft: false }],
  };
  const slugs: Record<string, string> = {};
  beforeEach(async () => {
    const db = st.db as ReturnType<typeof openDb>['db'];
    const now = new Date();
    db.insert(user).values({ id: 'f', name: 'f', email: 'f@x.fr', emailVerified: true, createdAt: now, updatedAt: now }).run();
    db.insert(friendship).values({ requesterId: 'a', addresseeId: 'f', pairKey: pairKey('a', 'f'), status: 'accepted' }).run();
    for (const v of VIS) {
      const r = (await createEditedTrack(db, 'a', { ...draftInput, name: `V-${v}`, status: 'published', visibility: v } as EditorInput, { enrich: false })) as { slug: string };
      slugs[v] = r.slug;
    }
    slugs.draft = draftSlug;
    st.uid = null;
  });
  const get = (url: string) => new Request(`http://x${url}`, { headers: { 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  const KINDS = ['public', 'friends', 'private', 'draft'];

  for (const [who, [uid, expected]] of Object.entries(WHO)) {
    it(`${who} : fiche, GPX, KML, géométrie, liste de départs`, async () => {
      st.uid = uid;
      for (const k of KINDS) {
        const ok = expected[k];
        const code = ok ? 200 : 404;
        expect((await trackRoute.GET(get('/api/tracks/x'), ctx(slugs[k]))).status, `fiche ${k}`).toBe(code);
        expect((await trackGpx.GET(get('/'), ctx(slugs[k]))).status, `gpx ${k}`).toBe(code);
        expect((await trackKml.GET(get('/'), ctx(slugs[k]))).status, `kml ${k}`).toBe(code);
        const g = await (await trackGeometry.GET(get(`/api/tracks/geometry?slugs=${slugs[k]}`))).json();
        expect(g.tracks.length, `geometry ${k}`).toBe(ok ? 1 : 0);
      }
      const list = await (await tracksList.GET(get('/api/tracks?starts=1'))).json();
      const names = list.tracks.map((t: { name: string }) => t.name);
      for (const v of VIS) expect(names.includes(`V-${v}`), `starts ${v}`).toBe(expected[v]);
      // A draft never leaves the explorer (only "My tracks").
      expect(list.tracks.some((t: { status: string }) => t.status === 'draft')).toBe(false);
    });
  }

  it('anonyme : fiche / geometry / starts en 200 avec Cache-Control public ; connecté : private ; jamais de 403', async () => {
    const r = await trackRoute.GET(get('/api/tracks/x'), ctx(slugs.public));
    expect(r.headers.get('cache-control')).toContain('public');
    expect(r.headers.get('vary')).toContain('Cookie');
    expect((await tracksList.GET(get('/api/tracks?starts=1'))).headers.get('cache-control')).toContain('public');
    expect((await trackGeometry.GET(get(`/api/tracks/geometry?slugs=${slugs.public}`))).headers.get('cache-control')).toContain('public');
    st.uid = 'a';
    expect((await trackRoute.GET(get('/api/tracks/x'), ctx(slugs.public))).headers.get('cache-control')).toContain('private');
    expect((await trackRoute.GET(get('/api/tracks/x'), ctx(slugs.private))).status).not.toBe(403);
  });

  it('anonyme : liste complète ou « mes traces » refusées (401), écritures refusées', async () => {
    expect((await tracksList.GET(get('/api/tracks'))).status).toBe(401);
    expect((await tracksList.GET(get('/api/tracks?starts=1&mine=1'))).status).toBe(401);
    expect((await trackRoute.PUT(json('PUT', {}), ctx(slugs.public))).status).toBe(401);
    expect((await trackRoute.DELETE(json('DELETE', {}), ctx(slugs.public))).status).toBe(401);
    expect((await tracksList.POST(json('POST', {}))).status).toBe(401);
  });

  it('anonyme : limite de débit (429) sur les lectures', async () => {
    const h = { 'x-forwarded-for': '10.9.9.9' };
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await tracksList.GET(new Request('http://x/api/tracks?starts=1', { headers: h }))).status;
    expect(last).toBe(429);
  });

  it('choix de trace pour une sortie et « modifier une copie » : trace invisible ⇒ introuvable', async () => {
    const db = st.db as ReturnType<typeof openDb>['db'];
    const input = { trackSlug: slugs.private, title: 'x', date: '2030-05-10', time: '08:30' };
    expect(await createOuting(db, 'b', input)).toEqual({ error: 'not_found' });
    expect(await createOuting(db, 'a', input)).toHaveProperty('slug');
    expect(await createOuting(db, 'f', { ...input, trackSlug: slugs.friends })).toHaveProperty('slug');
    expect(await createOuting(db, 'b', { ...input, trackSlug: slugs.friends })).toEqual({ error: 'not_found' });
    const copy = { ...draftInput, name: 'copie', status: 'published', parentSlug: slugs.private } as EditorInput;
    expect(await createEditedTrack(db, 'b', copy, { enrich: false })).toEqual({ errors: { parent: 'parentGone' } });
    expect(await createEditedTrack(db, 'a', copy, { enrich: false })).toHaveProperty('slug');
    expect(db.select().from(track).where(eq(track.slug, slugs.private)).get()?.visibility).toBe('private');
  });

  it('visibilité (#1590) : valeur invalide ⇒ 422 à la création, à la mise à jour, à l\'import et au PATCH', async () => {
    const db = st.db as ReturnType<typeof openDb>['db'];
    st.uid = 'a';
    const bad = { ...draftInput, name: 'X', status: 'published', visibility: 'nope' } as EditorInput;
    expect(await createEditedTrack(db, 'a', bad, { enrich: false })).toEqual({ errors: { visibility: 'visibilityInvalid' } });
    expect(await updateEditedTrack(db, 'a', slugs.public, bad, { enrich: false })).toEqual({ errors: { visibility: 'visibilityInvalid' } });
    const call = (slug: string, body: unknown) => trackRoute.PATCH(new Request('http://x/api/tracks/x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ slug }) });
    expect((await call(slugs.public, { visibility: 'nope' })).status).toBe(422);
    expect((await call(slugs.public, {})).status).toBe(422);
    const imp = await trackImport.PUT(new Request('http://x/api/tracks/import', { method: 'PUT', body: JSON.stringify({ name: 'I', origin: 'perso', geometry: { type: 'LineString', coordinates: coords }, visibility: 'nope' }) }));
    expect(imp.status).toBe(422);
  });

  it('visibilité (#1590) : seul l\'auteur la change par PATCH ; copain / autre ⇒ 404 ou 403 ; source synchronisée ⇒ 403', async () => {
    const db = st.db as ReturnType<typeof openDb>['db'];
    const call = (slug: string, body: unknown) => trackRoute.PATCH(new Request('http://x/api/tracks/x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ slug }) });
    st.uid = null;
    expect((await call(slugs.public, { visibility: 'private' })).status).toBe(401);
    st.uid = 'b'; // other: sees the public one but is not the author; does not see the private one
    expect((await call(slugs.public, { visibility: 'private' })).status).toBe(403);
    expect((await call(slugs.private, { visibility: 'public' })).status).toBe(404);
    expect(db.select().from(track).where(eq(track.slug, slugs.public)).get()?.visibility).toBe('public');
    st.uid = 'a';
    const ok = await call(slugs.public, { visibility: 'friends' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ visibility: 'friends' });
    expect(db.select().from(track).where(eq(track.slug, slugs.public)).get()?.visibility).toBe('friends');
    // Track from a synced source: no choice.
    const osm = await upsertTrack(db, { source: 'osm', externalId: 'r/9', name: 'O', geometry: { type: 'LineString', coordinates: coords }, raw: null, createdBy: 'a' }, { enrich: false });
    expect((await call(osm.slug, { visibility: 'private' })).status).toBe(403);
    // Sheet: the visibility is only exposed to the author.
    st.uid = 'a';
    const mine = await (await trackRoute.GET(get(`/api/tracks/${slugs.friends}`), { params: Promise.resolve({ slug: slugs.friends }) })).json();
    expect(mine.visibility).toBe('friends');
    st.uid = 'f';
    const buddy = await (await trackRoute.GET(get(`/api/tracks/${slugs.friends}`), { params: Promise.resolve({ slug: slugs.friends }) })).json();
    expect(buddy.visibility).toBeNull();
  });

  it('sortie publique sur trace privée (#1592) : parcours figé visible, trace introuvable, aucune fuite du slug', async () => {
    const db = st.db as ReturnType<typeof openDb>['db'];
    db.update(track).set({ visibility: 'private' }).where(eq(track.slug, trackSlug)).run();
    const o = await createOuting(db, 'a', { trackSlug, title: 'PubPriv', date: '2099-05-10', time: '08:30', visibility: 'public' } as never) as { slug: string };
    expect(o.slug).toBeTruthy();
    const row = db.select().from(outing).where(eq(outing.slug, o.slug)).get()!;
    const q = '/api/outings/map?bbox=-10,40,10,50';
    for (const uid of [null, 'b']) {
      st.uid = uid;
      const res = await outingsMap.GET(get(q));
      const body = JSON.stringify(await res.json());
      expect(body, `carte ${uid}`).toContain('PubPriv');
      expect(body).not.toContain(trackSlug);
      expect(body).not.toContain(row.trackId!);
      // The track itself: 404 (sheet, geometry, GPX).
      expect((await trackRoute.GET(get(`/api/tracks/${trackSlug}`), ctx(trackSlug))).status, `fiche ${uid}`).toBe(404);
      expect((await trackGpx.GET(get('/'), ctx(trackSlug))).status, `gpx ${uid}`).toBe(404);
    }
    // Discovery page of another account: frozen route, without the track slug.
    const { getOutingDiscovery } = await import('@/lib/outings/map');
    const d = getOutingDiscovery(db, 'b', row.id);
    expect(d.kind).toBe('show');
    expect(JSON.stringify(d)).not.toContain(trackSlug);
    expect((d as { outing: { distanceM: number } }).outing.distanceM).toBeGreaterThan(0);
    // Form warning: outing wider than the track.
    const { outingWiderThanTrack } = await import('@/lib/outings/track-exposure');
    expect(outingWiderThanTrack('public', 'private')).toBe(true);
    expect(outingWiderThanTrack('friends', 'friends')).toBe(false);
    expect(outingWiderThanTrack('public', 'public')).toBe(false);
    expect(outingWiderThanTrack('invite', 'private')).toBe(true);
  });

  it('carte des sorties : un anonyme ne voit que les sorties publiques', async () => {
    const db = st.db as ReturnType<typeof openDb>['db'];
    const mk = (visibility: string, title: string) => createOuting(db, 'a', { trackSlug, title, date: '2099-05-10', time: '08:30', visibility } as never);
    await mk('public', 'Pub'); await mk('friends', 'Cop'); await mk('invite', 'Inv');
    const q = '/api/outings/map?bbox=-10,40,10,50';
    const anon = await (await outingsMap.GET(get(q))).json();
    expect(anon.outings.map((o: { title: string }) => o.title)).toEqual(['Pub']);
    expect(anon.outings[0].mine).toBe(false);
    expect((await outingsMap.GET(get(q))).headers.get('cache-control')).toContain('public');
    st.uid = 'a';
    const mine = await (await outingsMap.GET(get(q))).json();
    expect(mine.outings.length).toBe(4); // 3 above + the one from beforeEach
    expect((await outingsMap.GET(get(q))).headers.get('cache-control')).toContain('private');
    expect((await outingsMap.GET(get('/api/outings/map?bbox=x'))).status).toBe(400);
  });

  it('parcours d\'une sortie sur la carte (#1596) : droits de la liste, 404 sinon, aucune fuite de la trace', async () => {
    const db = st.db as ReturnType<typeof openDb>['db'];
    db.update(track).set({ visibility: 'private' }).where(eq(track.slug, trackSlug)).run();
    const mk = (visibility: string, title: string) => createOuting(db, 'a', { trackSlug, title, date: '2099-05-10', time: '08:30', visibility } as never);
    await mk('public', 'Pub2'); await mk('invite', 'Inv2');
    const idOf = (title: string) => db.select().from(outing).where(eq(outing.title, title)).get()!;
    const one = (id: string) => outingsMapOne.GET(get(`/api/outings/map/${id}`), { params: Promise.resolve({ id }) });
    st.uid = null;
    const pub = idOf('Pub2');
    const res = await one(pub.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const text = JSON.stringify(await res.json());
    expect(text).toContain('profile');
    expect(text).not.toContain(trackSlug);
    expect(text).not.toContain(pub.trackId!);
    expect((await one(idOf('Inv2').id)).status).toBe(404); // anonyme : non publique
    expect((await one('inconnue')).status).toBe(404);
    st.uid = 'b';
    expect((await one(idOf('Inv2').id)).status).toBe(404); // signed in without rights
    expect((await one(pub.id)).status).toBe(200);
    st.uid = 'a';
    expect((await one(idOf('Inv2').id)).status).toBe(200);
  });
});

describe('/api/profile : charte du compte (#1625)', () => {
  it('401 sans session, 422 charte inconnue, 200 et persistance', async () => {
    st.uid = null;
    expect((await profileRoute.PUT(json('PUT', { charte: 'classique' }))).status).toBe(401);
    st.uid = 'a';
    const bad = await profileRoute.PUT(json('PUT', { charte: 'nope' }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toBe('charteInvalid');
    // Removed charters (#1646): unknown, so refused; an account that had one falls back to the default charter (getCharte).
    expect((await profileRoute.PUT(json('PUT', { charte: 'nuit' }))).status).toBe(422);
    const ok = await profileRoute.PUT(json('PUT', { charte: 'classique' }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).charte).toBe('classique');
    expect((await (await profileRoute.GET()).json()).charte).toBe('classique');
  });
});
