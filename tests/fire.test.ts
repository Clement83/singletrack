import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '@/db';
import { track } from '@/db/schema';
import {
  addDays, accessOf, fireInfo, getLevels, massifLabel, massifsForGeometry, parisDate, parseDayFile, saveMassifs, shouldFetch, fetchDay,
} from '@/lib/fire';
import { readMassifsFgb } from '@/lib/fire/fgb';
import { refreshFire } from '@/lib/fire/refresh';
import { upsertTrack, queryTracks } from '@/lib/tracks';
import type { TrackGeometry } from '@/lib/geo';

const fx = (f: string) => path.join(__dirname, 'fixtures/massifs', f);
const dayJson = (d: string) => JSON.parse(fs.readFileSync(fx(`${d}.json`), 'utf8'));
const fgb = () => new Uint8Array(fs.readFileSync(fx('massifs_83.fgb')));

// Track in the Maures massif (around Collobrières) and track outside any massif (Toulon coast, Hyères-les-Palmiers excluded).
const maures: TrackGeometry = { type: 'LineString', coordinates: [[6.3, 43.24, 100], [6.32, 43.25, 150], [6.34, 43.26, 200]] };
const horsMassif: TrackGeometry = { type: 'LineString', coordinates: [[2.0, 48.0, 50], [2.01, 48.01, 60]] };

async function setup() {
  const { db } = openDb(':memory:');
  saveMassifs(db, await readMassifsFgb(fgb()));
  return db;
}
const fakeFetch = (statusFor: (url: string) => number, body = '{}') => async (url: string) => ({ status: statusFor(url), text: async () => (statusFor(url) === 200 ? fs.readFileSync(fx(`${/(\d{8})\.json/.exec(url)![1].replace(/(\d{4})(\d{2})(\d{2})/, '$1$2$3')}.json`), 'utf8') : body) });

describe('contours (.fgb)', () => {
  it('lit les 9 massifs du Var avec leur code', async () => {
    const m = await readMassifsFgb(fgb());
    expect(m).toHaveLength(9);
    expect(m.find((x) => x.code === '835')?.name).toBe('MAURES');
    expect(m.every((x) => x.geometry.type === 'MultiPolygon')).toBe(true);
    expect(massifLabel('CORNICHE DES MAURES')).toBe('Corniche des Maures');
    expect(massifLabel("ILES D'HYERES")).toBe("Iles D'Hyeres");
  });
});

describe('fichiers de niveaux (réels, août 2026)', () => {
  it('lit niveau et procédure par massif', () => {
    const a = parseDayFile(dayJson('20260801'))!;
    expect(a.get('832')).toEqual({ level: 5, extra: 1 });
    expect(a.get('835')).toEqual({ level: 4, extra: 1 });
    const b = parseDayFile(dayJson('20260815'))!;
    expect(b.get('835')).toEqual({ level: 3, extra: 0 });
    expect(b.get('833')?.level).toBe(4);
    const c = parseDayFile(dayJson('20260822'))!;
    expect(c.get('831')?.level).toBe(2);
    expect(c.get('835')?.level).toBe(3);
    expect(parseDayFile(dayJson('20260810'))!.get('835')?.level).toBe(4);
  });
  it('rejette un format inattendu', () => {
    expect(parseDayFile({})).toBeNull();
    expect(parseDayFile({ massifs: { 835: 'x' } })).toBeNull();
    expect(parseDayFile({ massifs: { 835: [9, 0] } })).toBeNull();
    expect(parseDayFile(null)).toBeNull();
  });
  it('accès par niveau', () => {
    expect([1, 2, 3, 4, 5].map((l) => accessOf(l as 1))).toEqual(['ok', 'ok', 'warn', 'forbidden', 'forbidden']);
  });
});

describe('intersection trace ↔ massifs', () => {
  it('trouve le massif des Maures, rien hors massif', async () => {
    const db = await setup();
    expect(massifsForGeometry(db, maures)).toContain('835');
    expect(massifsForGeometry(db, horsMassif)).toEqual([]);
  });
  it('null tant que les contours ne sont pas importés', () => {
    expect(massifsForGeometry(openDb(':memory:').db, maures)).toBeNull();
  });
  it('est calculé à l’enregistrement d’une trace', async () => {
    const db = await setup();
    const t = { source: 'gpx' as const, externalId: null, name: 'Maures', geometry: maures };
    const { slug } = await upsertTrack(db, t, { enrich: false });
    const row = db.select().from(track).all().find((r) => r.slug === slug)!;
    expect(row.massifs).toContain('835');
  });
});

describe('récupération quotidienne', () => {
  it('enregistre les niveaux d’un jour réel et les relit', async () => {
    const db = await setup();
    const res = await fetchDay(db, '2026-08-01', fakeFetch(() => 200));
    expect(res).toBe('ok');
    expect(getLevels(db, '2026-08-01').get('835')?.level).toBe(4);
    const info = fireInfo(db, ['835'], '2026-08-01', new Date('2026-07-31T20:00:00Z'));
    expect(info.kind).toBe('ok');
    if (info.kind === 'ok') {
      expect(info.worst).toBe(4);
      expect(info.massifs[0].name).toBe('Maures');
    }
  });
  it('deux jours, deux couleurs différentes pour le même massif', async () => {
    const db = await setup();
    await fetchDay(db, '2026-08-01', fakeFetch(() => 200));
    await fetchDay(db, '2026-08-15', fakeFetch(() => 200));
    const w = (d: string) => { const i = fireInfo(db, ['835'], d); return i.kind === 'ok' ? i.worst : 0; };
    expect([w('2026-08-01'), w('2026-08-15')]).toEqual([4, 3]);
  });
  it('hors saison : 404 → message « hors période », aucune erreur', async () => {
    const db = await setup();
    const now = new Date('2026-11-12T12:00:00Z');
    expect(shouldFetch(db, '2026-11-12', '2026-11-12', 13, now)).toBe(false); // no call out of season
    expect(fireInfo(db, ['835'], '2026-11-12', now).kind).toBe('off_season');
    expect(await refreshFire(db, now, fakeFetch(() => 500))).toEqual([]);
    expect(fireInfo(db, [], '2026-11-12', now).kind).toBe('none');
  });
  it('en saison : 404 enregistré, réessai espacé de 3 h, demain pas avant 19 h', async () => {
    const db = await setup();
    const now = new Date('2026-08-14T10:00:00Z'); // noon in Paris
    expect(shouldFetch(db, '2026-08-15', '2026-08-14', 12, now)).toBe(false);
    expect(shouldFetch(db, '2026-08-14', '2026-08-14', 12, now)).toBe(true);
    expect(await fetchDay(db, '2026-08-14', fakeFetch(() => 404), now)).toBe('none');
    expect(shouldFetch(db, '2026-08-14', '2026-08-14', 12, now)).toBe(false);
    expect(shouldFetch(db, '2026-08-14', '2026-08-14', 15, new Date(now.getTime() + 3.1 * 3_600_000))).toBe(true);
    expect(shouldFetch(db, '2026-08-15', '2026-08-14', 19, new Date('2026-08-14T17:30:00Z'))).toBe(true);
  });
  it('format changé → erreur propre, donnée indisponible, pas d’exception', async () => {
    const db = await setup();
    const f = async () => ({ status: 200, text: async () => '{"nouveau":1}' });
    expect(await fetchDay(db, '2026-08-15', f)).toBe('error');
    expect(fireInfo(db, ['835'], '2026-08-15', new Date('2026-08-15T08:00:00Z')).kind).toBe('unavailable');
  });
  it('lendemain pas encore publié en saison → « publié la veille à 19 h »', async () => {
    const db = await setup();
    expect(fireInfo(db, ['835'], '2026-08-20', new Date('2026-08-14T10:00:00Z')).kind).toBe('pending');
  });
  it('dates Paris', () => {
    expect(parisDate(new Date('2026-08-14T22:30:00Z'))).toBe('2026-08-15');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
});

describe('filtre « accessibles »', () => {
  it('écarte les traces qui traversent un massif rouge/noir ce jour-là', async () => {
    const db = await setup();
    await upsertTrack(db, { source: 'gpx', externalId: null, name: 'Maures', geometry: maures }, { enrich: false });
    await upsertTrack(db, { source: 'gpx', externalId: null, name: 'Ailleurs', geometry: horsMassif }, { enrich: false });
    await fetchDay(db, '2026-08-01', fakeFetch(() => 200));
    await fetchDay(db, '2026-08-15', fakeFetch(() => 200));
    const names = (date: string) => queryTracks(db, {}, undefined, { openOn: date }).tracks.map((t) => t.name).sort();
    expect(names('2026-08-01')).toEqual(['Ailleurs']);
    expect(names('2026-08-15')).toEqual(['Ailleurs', 'Maures']);
  });
});
