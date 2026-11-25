import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, outingRide, track, user } from '@/db/schema';
import { createPairing, exchangePairing } from '@/lib/app/tokens';

// Solo outing from an app recording (#1765).
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

import * as rides from '@/app/api/app/rides/route';
import * as appOutings from '@/app/api/app/outings/route';

let n = 0;
const ip = () => ({ 'x-forwarded-for': `10.2.${Math.floor(n / 250)}.${n++ % 250}` });
const db = () => (st.h as ReturnType<typeof openDb>).db;
const ID = '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b';
const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="app"><wpt lat="43.2" lon="6.1"><name>Chute</name><time>2026-11-14T08:02:00Z</time></wpt><trk><trkseg>'
  + '<trkpt lat="43.2" lon="6.1"><ele>100</ele><time>2026-11-14T08:00:00Z</time></trkpt><trkpt lat="43.2" lon="6.105"><ele>120</ele><time>2026-11-14T08:03:00Z</time></trkpt><trkpt lat="43.2" lon="6.11"><ele>110</ele><time>2026-11-14T08:06:00Z</time></trkpt></trkseg></trk></gpx>';
const untimed = gpx.replace(/<time>[^<]*<\/time>/g, '');

const pairUser = (userId: string) => {
  const { code } = createPairing(db(), userId);
  const r = exchangePairing(db(), code, 'Pixel');
  if (!r.ok) throw new Error('pair');
  return r.token;
};
function send(token: string | null, fields: Record<string, string | undefined> = {}, xml: string | Blob = gpx, origin = 'http://x') {
  const fd = new FormData();
  fd.append('file', typeof xml === 'string' ? new File([xml], 'rec.gpx') : xml, 'rec.gpx');
  for (const [k, v] of Object.entries({ clientId: ID, title: 'Balade', ...fields })) if (v !== undefined) fd.append(k, v);
  return rides.POST(new Request(`${origin}/api/app/rides`, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...ip() }, body: fd }), { params: Promise.resolve({}) });
}
const json = async (r: Response) => (await r.json()) as Record<string, string>;

beforeEach(() => {
  const h = openDb(':memory:');
  st.h = h; st.uid = 'a';
  const now = new Date();
  for (const id of ['a', 'b']) h.db.insert(user).values({ id, name: id, email: `${id}@x.fr`, emailVerified: true, createdAt: now, updatedAt: now }).run();
  delete process.env.BETTER_AUTH_URL;
});

describe('POST /api/app/rides', () => {
  it('creates a private, past, solo outing from the first to the last point, with the ridden track', async () => {
    const token = pairUser('a');
    const res = await send(token);
    expect(res.status).toBe(201);
    const { slug, url } = await json(res);
    expect(url).toBe(`http://x/s/${slug}`);
    const o = db().select().from(outing).where(eq(outing.slug, slug)).get()!;
    expect(o).toMatchObject({ status: 'done', visibility: 'invite', title: 'Balade', ownerId: 'a', createdBy: 'a', trackId: null, clientId: ID });
    expect(o.startsAt.toISOString()).toBe('2026-11-14T08:00:00.000Z');
    expect(o.trackSnapshot.geometry.type).toBe('LineString');
    expect(o.trackSnapshot.distanceM).toBeGreaterThan(500);
    const r = db().select().from(outingRide).where(eq(outingRide.outingId, o.id)).all();
    expect(r).toHaveLength(1);
    expect(o.referenceRideId).toBe(r[0].id);
    expect(r[0]).toMatchObject({ elapsedSec: 360, authorUserId: 'a', invitationId: null });
    expect(db().select().from(track).all()).toHaveLength(0);
    expect(db().select().from(invitation).all()).toHaveLength(0);
    const list = (await (await appOutings.GET(new Request('http://x', { headers: { authorization: `Bearer ${token}`, ...ip() } }), { params: Promise.resolve({}) })).json()) as { outings: unknown[] };
    expect(JSON.stringify(list)).toContain(slug);
  });
  it('same clientId resent ⇒ 200, same slug, a single outing; another account ⇒ distinct outing', async () => {
    const token = pairUser('a');
    const first = await json(await send(token));
    const again = await send(token);
    expect(again.status).toBe(200);
    expect((await json(again)).slug).toBe(first.slug);
    expect(db().select().from(outing).all()).toHaveLength(1);
    const other = await send(pairUser('b'));
    expect(other.status).toBe(201);
    expect((await json(other)).slug).not.toBe(first.slug);
    expect(db().select().from(outing).all()).toHaveLength(2);
  });
  it('url uses the public origin', async () => {
    process.env.BETTER_AUTH_URL = 'https://singletrack.example/';
    const { url, slug } = await json(await send(pairUser('a'), {}, gpx, 'http://0.0.0.0:3000'));
    expect(url).toBe(`https://singletrack.example/s/${slug}`);
  });
  it('startedAt only serves when the GPX has no timestamps', async () => {
    const token = pairUser('a');
    const { slug } = await json(await send(token, { startedAt: '2026-01-01T10:00:00+01:00' }));
    expect(db().select().from(outing).where(eq(outing.slug, slug)).get()!.startsAt.toISOString()).toBe('2026-11-14T08:00:00.000Z');
    const r = await send(token, { clientId: '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6c', startedAt: '2026-01-01T10:00:00+01:00' }, untimed);
    expect(r.status).toBe(201);
    expect(db().select().from(outing).where(eq(outing.slug, (await json(r)).slug)).get()!.startsAt.toISOString()).toBe('2026-01-01T09:00:00.000Z');
    expect(await json(await send(token, { clientId: '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6d' }, untimed))).toEqual({ error: 'date' });
  });
  it('401 without or with a revoked token', async () => {
    expect((await send(null)).status).toBe(401);
    const token = pairUser('a');
    const { appToken } = await import('@/db/schema');
    db().delete(appToken).run();
    expect((await send(token)).status).toBe(401);
  });
  it('400 for invalid input, 413 for a huge file', async () => {
    const token = pairUser('a');
    expect(await json(await send(token, {}, 'hello'))).toEqual({ error: 'notGpx' });
    expect(await json(await send(token, {}, '<gpx version="1.1"></gpx>'))).toEqual({ error: 'noPoints' });
    expect(await json(await send(token, { clientId: 'nope' }))).toEqual({ error: 'clientIdInvalid' });
    expect(await json(await send(token, { title: '  ' }))).toEqual({ error: 'title' });
    expect(await json(await send(token, { title: 'x'.repeat(121) }))).toEqual({ error: 'title' });
    expect(await json(await send(token, { startedAt: 'yesterday' }))).toEqual({ error: 'date' });
    expect((await send(token, {}, new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]))).status).toBe(413);
    expect(db().select().from(outing).all()).toHaveLength(0);
  });
});
