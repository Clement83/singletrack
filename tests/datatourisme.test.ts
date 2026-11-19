import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { track } from '@/db/schema';
import type { Position, TrackGeometry } from '@/lib/geo';
import { upsertTrack } from '@/lib/tracks';
import {
  DatatourismeClient,
  RequestLimiter,
  firstPageUrl,
  overlapShare,
  pickTraceFile,
  redact,
  retryDelayMs,
  syncDatatourisme,
  tourDifficulty,
  tourToTrack,
  type DtTour,
} from '@/lib/datatourisme';

/** Fake clock: `sleep` advances time instantly, so the limiter's waits are observable without real delays. */
function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

const line = (lon: number, lat: number, n = 40, step = 0.0005): Position[] => Array.from({ length: n }, (_, i) => [lon + i * step, lat]);
const gpx = (pts: Position[]) =>
  `<?xml version="1.0"?><gpx version="1.1" creator="t"><trk><name>x</name><trkseg>${pts.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`).join('')}</trkseg></trk></gpx>`;

const tour = (uuid: string, opts: Partial<DtTour> & { file?: string | null } = {}): DtTour => ({
  uuid,
  label: { '@fr': `Circuit ${uuid}` },
  hasPracticeCondition: [{ hasLocomotionMode: [{ key: 'MBMode' }], hasDifficultyLevel: [{ key: 'DifficultTour' }] }],
  hasBeenCreatedBy: { legalName: 'OT de Test', homepage: ['https://ot.example.org'] },
  hasRepresentation:
    opts.file === null
      ? []
      : [{ hasRelatedResource: [{ locator: [opts.file ?? `https://media.example.org/${uuid}.gpx`], hasMimeType: [{ label: { '@fr': 'application/gpx+xml' } }] }] }],
  lastUpdate: '2026-10-01',
  ...opts,
});

describe('DATAtourisme — request limiter (#1643)', () => {
  it('one request at a time, ≥ 6 s between two starts', async () => {
    const c = fakeClock();
    const lim = new RequestLimiter({ minIntervalMs: 6000, maxPerHour: 500, now: c.now, sleep: c.sleep });
    const starts: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const job = () =>
      lim.schedule(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        starts.push(c.now());
        await Promise.resolve();
        inFlight--;
      });
    await Promise.all([job(), job(), job(), job()]);
    expect(maxInFlight).toBe(1);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(6000);
    expect(lim.count).toBe(4);
  });

  it('never more than maxPerHour starts in a sliding hour', async () => {
    const c = fakeClock();
    const lim = new RequestLimiter({ minIntervalMs: 0, maxPerHour: 3, now: c.now, sleep: c.sleep });
    const starts: number[] = [];
    for (let i = 0; i < 7; i++) await lim.schedule(async () => void starts.push(c.now()));
    for (let i = 3; i < starts.length; i++) expect(starts[i] - starts[i - 3]).toBeGreaterThanOrEqual(3_600_000);
  });

  it('a failing call does not block the next ones', async () => {
    const c = fakeClock();
    const lim = new RequestLimiter({ minIntervalMs: 10, maxPerHour: 10, now: c.now, sleep: c.sleep });
    await expect(lim.schedule(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(lim.schedule(async () => 42)).resolves.toBe(42);
  });
});

describe('DATAtourisme — client', () => {
  it('retries a 429 after Retry-After, then succeeds; the key is sent as a header, never in the URL', async () => {
    const c = fakeClock();
    const seen: { url: string; key: string | null }[] = [];
    let n = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, key: new Headers(init?.headers).get('X-API-Key') });
      n++;
      return n === 1 ? new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } }) : new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = new DatatourismeClient({ apiKey: 'secret-key', fetchImpl, sleep: c.sleep, apiLimiter: new RequestLimiter({ minIntervalMs: 6000, maxPerHour: 500, now: c.now, sleep: c.sleep }) });
    await expect(client.getJson('/tour')).resolves.toEqual({ ok: true });
    expect(c.sleeps).toContain(30_000);
    expect(seen.every((s) => s.key === 'secret-key' && !s.url.includes('secret-key'))).toBe(true);
  });

  it('gives up after the maximum number of attempts on 5xx, and does not retry a 404', async () => {
    const c = fakeClock();
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('', { status: calls < 100 ? 503 : 200 });
    }) as unknown as typeof fetch;
    const client = new DatatourismeClient({ apiKey: 'k', fetchImpl, sleep: c.sleep, random: () => 0, apiLimiter: new RequestLimiter({ minIntervalMs: 0, maxPerHour: 100, now: c.now, sleep: c.sleep }) });
    await expect(client.getJson('/tour')).rejects.toThrow('HTTP 503');
    expect(calls).toBe(4);
    const notFound = new DatatourismeClient({ apiKey: 'k', fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch, sleep: c.sleep, apiLimiter: new RequestLimiter({ minIntervalMs: 0, maxPerHour: 100, now: c.now, sleep: c.sleep }) });
    await expect(notFound.getJson('/catalog/x')).rejects.toThrow('HTTP 404');
  });

  it('backoff: Retry-After wins, otherwise exponential with jitter', () => {
    expect(retryDelayMs(1, '12', () => 0)).toBe(12_000);
    expect(retryDelayMs(1, null, () => 0)).toBe(10_000);
    expect(retryDelayMs(3, null, () => 0)).toBe(40_000);
    expect(retryDelayMs(1, null, () => 1)).toBe(20_000);
  });

  it('redacts an api_key query parameter', () => {
    expect(redact('https://api.datatourisme.fr/v1/tour?api_key=abc&page=2')).toBe('https://api.datatourisme.fr/v1/tour?api_key=…&page=2');
  });
});

describe('DATAtourisme — mapping', () => {
  it('asks only for mountain-bike tours (practice or theme), by department and update date', () => {
    const u = decodeURIComponent(firstPageUrl(['71', '83'], '2026-11-01'));
    expect(u).toContain('hasLocomotionMode.key[in]=MBMode,EAMBMode');
    expect(u).toContain('hasTheme.key[in]=ATV,ElectricATV');
    expect(u).toContain('isPartOfDepartment.insee[in]=71,83');
    expect(u).toContain('lastUpdate[gte]=2026-11-01');
    expect(decodeURIComponent(firstPageUrl([], null))).not.toContain('insee');
  });

  it('picks GPX before KML, ignores PDFs and images', () => {
    const t: DtTour = {
      uuid: 'u',
      hasRepresentation: [
        { hasRelatedResource: [{ locator: ['https://x/a.pdf'], hasMimeType: [{ label: { '@fr': 'application/pdf' } }] }] },
        { hasRelatedResource: [{ locator: ['https://x/a.kml'], hasMimeType: [{ label: { '@fr': 'application/vnd.google-earth.kml+xml' } }] }] },
        { hasRelatedResource: [{ locator: ['https://x/a.gpx'], hasMimeType: [{ label: { '@fr': 'application/gpx+xml' } }] }] },
      ],
    };
    expect(pickTraceFile(t)).toEqual({ url: 'https://x/a.gpx', kind: 'gpx' });
    expect(pickTraceFile({ uuid: 'v', hasRepresentation: [{ hasRelatedResource: [{ locator: ['https://x/p.jpg'], hasMimeType: [{ label: { '@fr': 'image/jpeg' } }] }] }] })).toBeNull();
  });

  it('maps difficulty, producer, licence and attribution', () => {
    expect(tourDifficulty(tour('a')).difficulty).toBe('red');
    const geometry: TrackGeometry = { type: 'LineString', coordinates: line(6, 45) };
    const t = tourToTrack(tour('a'), geometry, { url: 'https://media.example.org/a.gpx', kind: 'gpx' });
    expect(t).toMatchObject({ source: 'datatourisme', externalId: 'a', author: 'OT de Test', license: 'Licence Ouverte v2.0 (Etalab)', sourceUrl: 'https://ot.example.org' });
    expect(t.attribution).toContain('DATAtourisme');
  });

  it('overlap share: same line ≈ 1, a line 1 km away = 0', () => {
    const a: TrackGeometry = { type: 'LineString', coordinates: line(6, 45) };
    const b: TrackGeometry = { type: 'LineString', coordinates: line(6, 45.0001) };
    const far: TrackGeometry = { type: 'LineString', coordinates: line(6, 45.01) };
    expect(overlapShare(a, b)).toBeGreaterThan(0.95);
    expect(overlapShare(a, far)).toBe(0);
  });
});

describe('DATAtourisme — sync', () => {
  function fakeApi(pages: DtTour[][], files: Record<string, string>, log: string[] = []) {
    return (async (url: string) => {
      log.push(url);
      if (url.includes('media.example.org')) {
        const body = files[url];
        return body ? new Response(body, { status: 200 }) : new Response('', { status: 404 });
      }
      const m = /[?&]page=(\d+)/.exec(url);
      const p = m ? Number(m[1]) : 1;
      const next = p < pages.length ? `https://api.datatourisme.fr/v1/tour?page=${p + 1}` : null;
      return new Response(JSON.stringify({ objects: pages[p - 1], meta: { total: pages.flat().length, next } }), { status: 200 });
    }) as unknown as typeof fetch;
  }
  const client = (fetchImpl: typeof fetch) => {
    const c = fakeClock();
    return new DatatourismeClient({
      apiKey: 'k',
      fetchImpl,
      sleep: c.sleep,
      apiLimiter: new RequestLimiter({ minIntervalMs: 6000, maxPerHour: 500, now: c.now, sleep: c.sleep }),
      fileLimiter: new RequestLimiter({ minIntervalMs: 2000, maxPerHour: 1500, now: c.now, sleep: c.sleep }),
    });
  };
  const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'state.json');

  it('imports tours with a trace, counts the others, is idempotent and skips unchanged tours without downloading', async () => {
    const { db } = openDb(':memory:');
    const pages = [[tour('a'), tour('b', { file: null })], [tour('c')]];
    const files = { 'https://media.example.org/a.gpx': gpx(line(6, 45)), 'https://media.example.org/c.gpx': gpx(line(4, 46)) };
    const stateFile = tmpState();
    const calls: string[] = [];
    const r1 = await syncDatatourisme({ db, client: client(fakeApi(pages, files, calls)), zones: [], stateFile, today: () => '2026-11-19' });
    expect(r1).toMatchObject({ read: 3, created: 2, withoutTrace: 1, duplicates: 0, errors: 0, apiRequests: 2, fileRequests: 2 });
    const rows = db.select().from(track).where(eq(track.source, 'datatourisme')).all();
    expect(rows.map((t) => t.externalId).sort()).toEqual(['a', 'c']);
    expect(rows.every((t) => t.visibility === 'public')).toBe(true);
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8'))).toMatchObject({ next: null, lastComplete: '2026-11-19' });

    const calls2: string[] = [];
    const r2 = await syncDatatourisme({ db, client: client(fakeApi(pages, files, calls2)), zones: [], stateFile, full: true });
    expect(r2).toMatchObject({ created: 0, unchanged: 2, fileRequests: 0 });
  });

  it('skips a circuit that duplicates an existing OSM track', async () => {
    const { db } = openDb(':memory:');
    await upsertTrack(db, { source: 'osm', externalId: 'r1', name: 'OSM route', geometry: { type: 'LineString', coordinates: line(6, 45) } }, { enrich: false });
    const files = { 'https://media.example.org/a.gpx': gpx(line(6, 45.0001)) };
    const r = await syncDatatourisme({ db, client: client(fakeApi([[tour('a')]], files)), zones: [], stateFile: tmpState() });
    expect(r).toMatchObject({ created: 0, duplicates: 1 });
  });

  it('a short loop that runs on a longer track is not a duplicate (mutual overlap required)', async () => {
    const { db } = openDb(':memory:');
    await upsertTrack(db, { source: 'osm', externalId: 'r1', name: 'Long route', geometry: { type: 'LineString', coordinates: line(6, 45, 200) } }, { enrich: false });
    const files = { 'https://media.example.org/a.gpx': gpx(line(6, 45.0001, 40)) };
    const r = await syncDatatourisme({ db, client: client(fakeApi([[tour('a')]], files)), zones: [], stateFile: tmpState() });
    expect(r).toMatchObject({ created: 1, duplicates: 0 });
  });

  it('a broken trace file is counted and does not stop the sync', async () => {
    const { db } = openDb(':memory:');
    const files = { 'https://media.example.org/a.gpx': 'not xml', 'https://media.example.org/c.gpx': gpx(line(4, 46)) };
    const r = await syncDatatourisme({ db, client: client(fakeApi([[tour('a'), tour('b'), tour('c')]], files)), zones: [], stateFile: tmpState() });
    expect(r).toMatchObject({ created: 1, invalidTrace: 1, errors: 1 });
  });

  it('resumes an interrupted run from the saved next page', async () => {
    const { db } = openDb(':memory:');
    const pages = [[tour('a')], [tour('c')]];
    const files = { 'https://media.example.org/a.gpx': gpx(line(6, 45)), 'https://media.example.org/c.gpx': gpx(line(4, 46)) };
    const stateFile = tmpState();
    await syncDatatourisme({ db, client: client(fakeApi(pages, files)), zones: [], stateFile, maxPages: 1 });
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).next).toContain('page=2');
    const calls: string[] = [];
    const r = await syncDatatourisme({ db, client: client(fakeApi(pages, files, calls)), zones: [], stateFile });
    expect(calls[0]).toContain('page=2');
    expect(r).toMatchObject({ read: 1, created: 1 });
  });

  it('dry run: measures without downloading or writing', async () => {
    const { db } = openDb(':memory:');
    const calls: string[] = [];
    const r = await syncDatatourisme({ db, client: client(fakeApi([[tour('a'), tour('b', { file: null })]], {}, calls)), zones: [], stateFile: tmpState(), dryRun: true });
    expect(r).toMatchObject({ read: 2, withoutTrace: 1, created: 0, fileRequests: 0 });
    expect(calls.some((u) => u.includes('media.example.org'))).toBe(false);
    expect(db.select().from(track).all()).toHaveLength(0);
  });
});
