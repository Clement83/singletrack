import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { appPairing, appToken, invitation, outing, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createInvitation, createOuting } from '@/lib/outings';
import type { Position } from '@/lib/geo';
import { createPairing, exchangePairing, PAIRING_TTL_MS } from '@/lib/app/tokens';

// Companion app API (#1720): pairing, Bearer token, outings in JSON, ridden track upload.
const st = vi.hoisted(() => ({ h: undefined as unknown, uid: null as string | null }));
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

import * as pair from '@/app/api/app/pair/route';
import * as appOutings from '@/app/api/app/outings/route';
import * as appOuting from '@/app/api/app/outings/[ref]/route';
import * as appRide from '@/app/api/app/outings/[ref]/ride/route';
import * as appGuest from '@/app/api/app/i/[token]/route';
import * as devices from '@/app/api/profile/app-devices/route';
import { isPublicPath } from '@/lib/public-routes';

const coords: Position[] = Array.from({ length: 30 }, (_, i) => [6.14 + i * 0.001, 43.22 + (i % 3) * 0.0005, 100 + i * 2] as Position);
let n = 0;
const ip = () => ({ 'x-forwarded-for': `10.1.${Math.floor(n / 250)}.${n++ % 250}` });
const ctx = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const gctx = (p: { token: string }) => ({ params: Promise.resolve(p) });
const post = (body: unknown) => new Request('http://x/api/app/pair', { method: 'POST', headers: { 'content-type': 'application/json', ...ip() }, body: JSON.stringify(body) });
const bearer = (token: string | null, init: RequestInit = {}) => new Request('http://x/api/app', { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...ip(), ...(init.headers as object) } });
const db = () => (st.h as ReturnType<typeof openDb>).db;

let slug: string, outingId: string;
const pairUser = (userId: string) => {
  const { code } = createPairing(db(), userId);
  const r = exchangePairing(db(), code, 'Pixel');
  if (!r.ok) throw new Error('pair');
  return r.token;
};

beforeEach(async () => {
  const h = openDb(':memory:');
  st.h = h; st.uid = 'a';
  const now = new Date();
  for (const id of ['a', 'b']) h.db.insert(user).values({ id, name: id, email: `${id}@x.fr`, emailVerified: true, createdAt: now, updatedAt: now }).run();
  const t = await upsertTrack(h.db, { source: 'osm', externalId: 'r1', name: 'T', license: 'ODbL', attribution: '© OSM', geometry: { type: 'LineString', coordinates: coords }, raw: {}, createdBy: 'a' }, { enrich: false });
  const o = (await createOuting(h.db, 'a', { trackSlug: t.slug, title: 'Sortie', date: '2030-05-10', time: '08:30', visibility: 'invite' })) as { slug: string };
  slug = o.slug;
  outingId = h.db.select().from(outing).where(eq(outing.slug, slug)).get()!.id;
});

describe('jumelage', () => {
  it('le code est à usage unique : rejeu ⇒ 401', async () => {
    const { code } = createPairing(db(), 'a');
    const ok = await pair.POST(post({ code, deviceName: 'Pixel 8' }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { token: string }).token.length).toBeGreaterThan(30);
    expect((await pair.POST(post({ code }))).status).toBe(401);
  });
  it('code expiré, inconnu ou mal formé ⇒ 401 ; seul le hash est stocké', async () => {
    const t0 = new Date('2030-01-01T10:00:00Z');
    const { code } = createPairing(db(), 'a', t0);
    expect(db().select().from(appPairing).all().every((r) => !r.codeHash.includes(code))).toBe(true);
    expect(exchangePairing(db(), code, 'x', new Date(t0.getTime() + PAIRING_TTL_MS + 1)).ok).toBe(false);
    for (const bad of ['ZZZZZZ', 'abc', 123, null]) expect((await pair.POST(post({ code: bad }))).status).toBe(401);
    const tok = pairUser('a');
    expect(db().select().from(appToken).all().some((r) => r.tokenHash === tok)).toBe(false);
  });
  it('accepte la saisie en minuscules avec espace', () => {
    const { code } = createPairing(db(), 'a');
    expect(exchangePairing(db(), `${code.slice(0, 3)} ${code.slice(3)}`.toLowerCase(), 'x').ok).toBe(true);
  });
  it('limite le débit par IP (429)', async () => {
    const req = () => new Request('http://x', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: '{}' });
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await pair.POST(req())).status;
    expect(last).toBe(429);
  });
  it('/api/app est hors cookie (le proxy laisse passer), chaque route vérifie son jeton', () => {
    expect(isPublicPath('/api/app/outings')).toBe(true);
  });
});

describe('appareils (session)', () => {
  it('401 sans session ; code + QR ; liste ; révocation ⇒ 401 sur /api/app', async () => {
    st.uid = null;
    expect((await devices.GET()).status).toBe(401);
    expect((await devices.POST()).status).toBe(401);
    st.uid = 'a';
    const made = (await (await devices.POST()).json()) as { code: string; qr: string; link: string };
    expect(made.qr).toMatch(/^data:image\/png/);
    expect(made.link).toContain(`code=${made.code}`);
    const { token } = (await (await pair.POST(post({ code: made.code, deviceName: 'Pixel' }))).json()) as { token: string };
    const list = (await (await devices.GET()).json()) as { devices: { id: string; deviceName: string }[] };
    expect(list.devices).toHaveLength(1);
    expect((await appOutings.GET(bearer(token), ctx({}))).status).toBe(200);
    st.uid = 'b';
    const del = (id: string) => devices.DELETE(new Request('http://x', { method: 'DELETE', body: JSON.stringify({ id }) }));
    expect((await del(list.devices[0].id)).status).toBe(404); // not mine
    st.uid = 'a';
    expect((await del(list.devices[0].id)).status).toBe(200);
    expect((await appOutings.GET(bearer(token), ctx({}))).status).toBe(401);
  });
});

describe('/api/app/outings', () => {
  it('401 sans jeton, avec un jeton inconnu, ou avec la session seule', async () => {
    expect((await appOutings.GET(bearer(null), ctx({}))).status).toBe(401);
    expect((await appOutings.GET(bearer('x'.repeat(43)), ctx({}))).status).toBe(401);
    expect((await appOuting.GET(bearer(null), ctx({ ref: slug }))).status).toBe(401);
  });
  it('ne renvoie que mes sorties (organisateur + invité lié), sans jeton d’invitation', async () => {
    const tokenA = pairUser('a');
    const tokenB = pairUser('b');
    const mine = (await (await appOutings.GET(bearer(tokenA), ctx({}))).json()) as { outings: { id: string; slug?: string; role: string; title: string }[] };
    expect(mine.outings).toMatchObject([{ id: outingId, slug, role: 'organizer', title: 'Sortie' }]);
    expect(((await (await appOutings.GET(bearer(tokenB), ctx({}))).json()) as { outings: unknown[] }).outings).toEqual([]);
    // b is linked as a guest: sees it with role guest, and not the slug
    const inv = createInvitation(db(), 'a', slug, 'B');
    if (!inv.ok) throw new Error('inv');
    db().update(invitation).set({ userId: 'b' }).where(eq(invitation.outingId, outingId)).run();
    const asGuest = (await (await appOutings.GET(bearer(tokenB), ctx({}))).json()) as { outings: Record<string, unknown>[] };
    expect(asGuest.outings).toHaveLength(1);
    expect(asGuest.outings[0]).toMatchObject({ role: 'guest', id: outingId });
    expect(asGuest.outings[0].slug).toBeUndefined();
  });
  it('détail : organisateur par slug, invité lié par id ; invisible ⇒ 404', async () => {
    const tokenA = pairUser('a');
    const tokenB = pairUser('b');
    const d = (await (await appOuting.GET(bearer(tokenA), ctx({ ref: slug }))).json()) as { track: { geometry: unknown; bbox: number[]; profile: unknown[]; slug?: string }; role: string; webPath: string };
    expect(d.role).toBe('organizer');
    expect(d.webPath).toBe(`/s/${slug}`);
    expect(d.track.bbox).toHaveLength(4);
    expect(d.track.profile.length).toBeGreaterThan(2);
    expect(d.track.slug).toBeUndefined();
    expect((await appOuting.GET(bearer(tokenB), ctx({ ref: slug }))).status).toBe(404);
    expect((await appOuting.GET(bearer(tokenB), ctx({ ref: outingId }))).status).toBe(404);
    expect((await appOuting.GET(bearer(tokenA), ctx({ ref: 'inconnu' }))).status).toBe(404);
    createInvitation(db(), 'a', slug, 'B');
    db().update(invitation).set({ userId: 'b' }).where(eq(invitation.outingId, outingId)).run();
    const g = await appOuting.GET(bearer(tokenB), ctx({ ref: outingId }));
    expect(g.status).toBe(200);
    expect(((await g.json()) as { role: string }).role).toBe('guest');
    // the slug never makes a linked guest an organiser: same guest view
    expect(((await (await appOuting.GET(bearer(tokenB), ctx({ ref: slug }))).json()) as { role: string }).role).toBe('guest');
  });
});

describe('/api/app/i/[token] (sans compte)', () => {
  it('même sortie que /i/<token>, 404 si révoqué ou inconnu', async () => {
    const inv = createInvitation(db(), 'a', slug, 'Léo') as unknown as { ok: boolean; token: string };
    const res = await appGuest.GET(bearer(null), gctx({ token: inv.token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string; title: string; slug?: string; webPath: unknown; track: { name: string } };
    expect(body).toMatchObject({ role: 'guest', title: 'Sortie', webPath: null });
    expect(body.slug).toBeUndefined();
    expect((await appGuest.GET(bearer(null), gctx({ token: 'inconnu'.repeat(5) }))).status).toBe(404);
    db().update(invitation).set({ revokedAt: new Date() }).where(eq(invitation.outingId, outingId)).run();
    expect((await appGuest.GET(bearer(null), gctx({ token: inv.token }))).status).toBe(404);
  });
});

describe('/api/app/outings/[ref]/ride', () => {
  const upload = (token: string | null, xml: string) => {
    const fd = new FormData();
    fd.append('file', new File([xml], 'ride.gpx'));
    return appRide.POST(bearer(token, { method: 'POST', body: fd }), ctx({ ref: slug }));
  };
  const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="app"><wpt lat="43.2" lon="6.1"><name>Chute</name><time>2026-11-14T08:02:00Z</time></wpt><trk><trkseg>'
    + '<trkpt lat="43.2" lon="6.1"><time>2026-11-14T08:00:00Z</time></trkpt><trkpt lat="43.2" lon="6.105"><time>2026-11-14T08:03:00Z</time></trkpt><trkpt lat="43.2" lon="6.11"><time>2026-11-14T08:06:00Z</time></trkpt></trkseg></trk></gpx>';

  it('401 sans jeton ; 409 avant la sortie ; 201 avec des waypoints ; visible dans la liste', async () => {
    const token = pairUser('a');
    expect((await upload(null, gpx)).status).toBe(401);
    expect((await upload(token, gpx)).status).toBe(409);
    db().update(outing).set({ startsAt: new Date(Date.now() - 3600_000) }).where(eq(outing.id, outingId)).run();
    expect((await upload(token, gpx)).status).toBe(201);
    const list = (await (await appRide.GET(bearer(token), ctx({ ref: slug }))).json()) as { rides: unknown[] };
    expect(list.rides).toHaveLength(1);
    expect((await upload(pairUser('b'), gpx)).status).toBe(404);
  });
});
