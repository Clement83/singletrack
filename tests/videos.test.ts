import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, outingVideo, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import {
  createOuting, deleteVideo, enqueueVideo, listVideos, processVideo, readyVideoFile, receiveUpload, saveVideo, videoFile, videoQueueIdle,
  buildRecap, VIDEO_MAX_PER_OUTING, _resetRateLimit,
} from '@/lib/outings';
import { ffmpegPath, ffprobePath, hasFfmpeg, parseIso6709, parseProbe, probeVideo, run } from '@/lib/media/ffmpeg';
import { fitSize, qsvArgs, qsvTranspose, x264Args } from '@/lib/media/video-args';
import { encoderMode, encoderPlan } from '@/lib/media/video-convert';
import { parseRange } from '@/lib/outings/video-http';

/**
 * Phone-like clip (#1693): 2 s of HEVC 1920×1080 at 60 fps in a MOV, AAC sound, QuickTime capture time and ISO 6709
 * position, generated with:
 *   ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=60 -f lavfi -i sine=frequency=440 -t 2 -c:v libx265 -preset ultrafast \
 *     -crf 40 -tag:v hvc1 -c:a aac -b:a 32k -movflags use_metadata_tags -metadata creation_time=2026-11-14T08:30:00.000000Z \
 *     -metadata com.apple.quicktime.location.ISO6709=+43.2153+006.0712+120.000/ tests/fixtures/video/clip-hevc.mov
 */
const FIXTURE = join(__dirname, 'fixtures/video/clip-hevc.mov');

const pts = Array.from({ length: 12 }, (_, i) => [6.06 + i * 0.002, 43.2153, 100 + i * 10] as [number, number, number]);

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: pts }, raw: {},
  }, { enrich: false });
  const r = await createOuting(db, 'u1', { trackSlug: t.slug, title: 'Sortie', date: '2026-11-14', time: '08:00' });
  if (!('slug' in r)) throw new Error('création');
  const o = db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  db.insert(invitation).values([
    { id: 'i1', outingId: o.id, tokenHash: 'h1', name: 'Léa', status: 'yes' },
    { id: 'i2', outingId: o.id, tokenHash: 'h2', name: 'Max', status: 'yes' },
  ]).run();
  return { db, o, guest: { kind: 'guest' as const, invitationId: 'i1' }, other: { kind: 'guest' as const, invitationId: 'i2' }, orga: { kind: 'organizer' as const, userId: 'u1' } };
}
const after = new Date('2026-11-14T12:00:00Z');
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'video-')); _resetRateLimit(); });
const upload = (src = FIXTURE) => {
  const p = join(dir, `${crypto.randomUUID()}.upload`);
  copyFileSync(src, p);
  return p;
};

describe('ffprobe parsing (#1693)', () => {
  it('ISO 6709 : position Apple et Android, altitude facultative ; 0,0 et hors bornes → null', () => {
    expect(parseIso6709('+43.2153+006.0712+120.000/')).toEqual({ lat: 43.2153, lon: 6.0712 });
    expect(parseIso6709('-33.8688+151.2093/')).toEqual({ lat: -33.8688, lon: 151.2093 });
    expect(parseIso6709('+00.0000+000.0000/')).toBeNull();
    expect(parseIso6709('+95.0+010.0/')).toBeNull();
    expect(parseIso6709('n’importe quoi')).toBeNull();
    expect(parseIso6709(undefined)).toBeNull();
  });
  it('rotation iPhone (side data −90) ⇒ taille affichée inversée ; date Apple avec décalage prioritaire', () => {
    const p = parseProbe({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.5', tags: { creation_time: '2026-11-14T08:00:00Z', 'com.apple.quicktime.creationdate': '2026-11-14T09:30:00+0100', 'com.apple.quicktime.location.ISO6709': '+43.2153+006.0712+120.000/' } },
      streams: [{ codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, pix_fmt: 'yuv420p10le', avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }] }, { codec_type: 'audio', codec_name: 'aac' }],
    })!;
    expect(p).toMatchObject({ codec: 'hevc', rotation: 270, displayWidth: 1080, displayHeight: 1920, durationMs: 12500, hasAudio: true, pos: { lat: 43.2153, lon: 6.0712 } });
    expect(p.takenAt).toBe(Date.parse('2026-11-14T08:30:00Z'));
    expect(p.fps).toBeCloseTo(29.97, 2);
  });
  it('pas de flux vidéo ⇒ null ; horloge à zéro ⇒ pas d’heure', () => {
    expect(parseProbe({ streams: [{ codec_type: 'audio' }] })).toBeNull();
    expect(parseProbe({ format: { tags: { creation_time: '1970-01-01T00:00:00Z' } }, streams: [{ codec_type: 'video', width: 2, height: 2 }] })!.takenAt).toBeNull();
  });
});

describe('ffmpeg arguments (#1693)', () => {
  const probe = parseProbe({ format: { format_name: 'mov', duration: '5' }, streams: [{ codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, side_data_list: [{ rotation: 90 }] }] })!;
  it('720p : côté long ≤ 1280, jamais agrandi, côtés pairs', () => {
    expect(fitSize(1920, 1080)).toEqual({ w: 1280, h: 720 });
    expect(fitSize(1080, 1920)).toEqual({ w: 720, h: 1280 });
    expect(fitSize(640, 360)).toEqual({ w: 640, h: 360 });
    expect(fitSize(1001, 333)).toEqual({ w: 1002, h: 334 });
  });
  it('x264 : orientation affichée, 8 bits, métadonnées effacées, faststart, 30 i/s max', () => {
    const a = x264Args('in', 'out.mp4', probe).join(' ');
    expect(a).toContain('scale=720:1280,format=yuv420p');
    expect(a).toContain('-c:v libx264');
    expect(a).toContain('-map_metadata -1');
    expect(a).toContain('-movflags +faststart');
    expect(a).toContain('-fpsmax 30');
    expect(a).toContain('-an');
  });
  it('QSV : taille dans l’orientation stockée, rotation par vpp_qsv, h264_qsv niveau 40', () => {
    const a = qsvArgs('in', 'out.mp4', probe).join(' ');
    expect(a).toContain('vpp_qsv=transpose=cclock:w=1280:h=720:format=nv12');
    expect(a).toContain('-c:v h264_qsv');
    expect(a).toContain('-hwaccel qsv');
    expect(a).toContain('-level 40');
    expect(qsvTranspose(0)).toBeNull();
    expect(qsvTranspose(270)).toBe('clock');
  });
  it('choix de l’encodeur : QSV d’abord si l’iGPU est là (repli x264 toujours prévu), sinon x264', () => {
    expect(encoderMode(undefined)).toBe('auto');
    expect(encoderMode('QSV')).toBe('qsv');
    expect(encoderMode('nimp')).toBe('auto');
    expect(encoderPlan('auto', true)).toEqual(['h264_qsv', 'libx264']);
    expect(encoderPlan('auto', false)).toEqual(['libx264']);
    expect(encoderPlan('qsv', false)).toEqual(['h264_qsv', 'libx264']);
    expect(encoderPlan('x264', true)).toEqual(['libx264']);
  });
  it('Range HTTP : début-fin, ouvert, suffixe ; hors fichier ⇒ invalid', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-1000', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=200-', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
});

describe('upload stream (#1693)', () => {
  it('écrit le corps sur disque ; vide ⇒ notVideo', async () => {
    const ok = await receiveUpload(new Blob([new Uint8Array(1000)]).stream(), dir);
    expect(ok.ok && existsSync(ok.path)).toBe(true);
    expect(await receiveUpload(new Blob([]).stream(), dir)).toEqual({ ok: false, error: 'notVideo' });
    expect(await receiveUpload(null, dir)).toEqual({ ok: false, error: 'notVideo' });
  });
});

let ff = false;
beforeAll(async () => { ff = await hasFfmpeg(); });

describe('conversion with ffmpeg (#1693)', () => {
  it('fixture présente', () => expect(existsSync(FIXTURE)).toBe(true));

  it('MOV HEVC de téléphone ⇒ MP4 H.264 720p + miniature, heure et position lues puis absentes du fichier', async (ctx) => {
    if (!ff) ctx.skip();
    const { db, o, guest } = await setup();
    const r = await saveVideo(db, o, guest, upload(), { now: after, dir, enqueue: false });
    expect(r.ok).toBe(true);
    const id = (r as { id: string }).id;
    const row = db.select().from(outingVideo).where(eq(outingVideo.id, id)).get()!;
    expect(row).toMatchObject({ status: 'pending', lat: 43.2153, lon: 6.0712, takenAt: Date.parse('2026-11-14T08:30:00Z') });
    expect(listVideos(db, o.id, guest)[0].status).toBe('pending');
    expect(readyVideoFile(db, o.id, id, 'mp4', dir)).toBeNull();

    expect(await processVideo(db, id, dir, { plan: ['libx264'] })).toBe('ready');
    const done = db.select().from(outingVideo).where(eq(outingVideo.id, id)).get()!;
    expect(done).toMatchObject({ status: 'ready', width: 1280, height: 720, encoder: 'libx264' });
    expect(done.durationMs).toBeGreaterThan(1900);
    const mp4 = readyVideoFile(db, o.id, id, 'mp4', dir)!;
    expect(existsSync(videoFile(dir, o.id, id, 'src'))).toBe(false);
    expect(existsSync(readyVideoFile(db, o.id, id, 'thumb', dir)!)).toBe(true);
    const p = (await probeVideo(mp4))!;
    expect(p).toMatchObject({ codec: 'h264', displayWidth: 1280, displayHeight: 720, hasAudio: true, pos: null, takenAt: null, pixFmt: 'yuv420p' });
    expect(p.fps).toBeLessThanOrEqual(30);
    const tags = await run(ffprobePath(), ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', mp4]);
    expect(tags.stdout).not.toMatch(/ISO6709|location|creation_time|2026-11-14/i);
    // faststart: the `moov` box comes before `mdat`.
    const head = (await import('node:fs')).readFileSync(mp4).subarray(0, 4096).toString('latin1');
    expect(head.indexOf('moov')).toBeGreaterThan(-1);
    expect(head.indexOf('moov')).toBeLessThan(head.indexOf('mdat') === -1 ? Infinity : head.indexOf('mdat'));
  }, 120_000);

  it('QSV indisponible ⇒ repli x264 automatique, même résultat', async (ctx) => {
    if (!ff) ctx.skip();
    const { db, o, guest } = await setup();
    const r = await saveVideo(db, o, guest, upload(), { now: after, dir, enqueue: false });
    const id = (r as { id: string }).id;
    expect(await processVideo(db, id, dir, { plan: ['h264_qsv', 'libx264'] })).toBe('ready');
    // On a machine with a working iGPU the first encoder may succeed: both are valid outcomes.
    expect(['h264_qsv', 'libx264']).toContain(db.select().from(outingVideo).where(eq(outingVideo.id, id)).get()!.encoder);
  }, 120_000);

  it('deux envois ⇒ convertis l’un après l’autre, sans bloquer la boucle d’événements', async (ctx) => {
    if (!ff) ctx.skip();
    const { db, o, guest, orga } = await setup();
    const a = (await saveVideo(db, o, guest, upload(), { now: after, dir, enqueue: false })) as { id: string };
    const b = (await saveVideo(db, o, orga, upload(), { now: after, dir, enqueue: false })) as { id: string };
    const order: string[] = [];
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 20);
    const pa = enqueueVideo(db, a.id, dir, { plan: ['libx264'] }).then((s) => { order.push(`a:${s}`); });
    const pb = enqueueVideo(db, b.id, dir, { plan: ['libx264'] }).then((s) => { order.push(`b:${s}`); });
    // b waits for a: still pending while a converts.
    await new Promise((r) => setTimeout(r, 50));
    expect(db.select().from(outingVideo).where(eq(outingVideo.id, b.id)).get()!.status).toBe('pending');
    await Promise.all([pa, pb, videoQueueIdle()]);
    clearInterval(timer);
    expect(order).toEqual(['a:ready', 'b:ready']);
    expect(ticks).toBeGreaterThan(5);
  }, 180_000);

  it('limites : trop long, pas une vidéo, 15 par sortie, annulée, trop tôt', async (ctx) => {
    if (!ff) ctx.skip();
    const { db, o, guest } = await setup();
    const long = join(dir, 'long.mp4');
    await run(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=64x64:rate=5', '-t', '32', '-c:v', 'libx264', '-y', long]);
    expect(await saveVideo(db, o, guest, upload(long), { now: after, dir, enqueue: false })).toEqual({ ok: false, error: 'tooLong' });
    const txt = join(dir, 'x.txt');
    writeFileSync(txt, 'pas une vidéo');
    expect(await saveVideo(db, o, guest, upload(txt), { now: after, dir, enqueue: false })).toEqual({ ok: false, error: 'notVideo' });
    // A WebM (VP9) is refused: MP4/MOV only.
    const webm = join(dir, 'c.webm');
    await run(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=64x64:rate=5', '-t', '1', '-c:v', 'libvpx-vp9', '-y', webm]);
    if (existsSync(webm)) expect(await saveVideo(db, o, guest, upload(webm), { now: after, dir, enqueue: false })).toEqual({ ok: false, error: 'notVideo' });
    expect(await saveVideo(db, o, guest, upload(), { now: new Date('2026-11-13T12:00:00Z'), dir, enqueue: false })).toEqual({ ok: false, error: 'tooEarly' });
    for (let i = 0; i < VIDEO_MAX_PER_OUTING; i++) {
      db.insert(outingVideo).values({ outingId: o.id, invitationId: 'i1', status: 'ready', width: 2, height: 2, durationMs: 1000 }).run();
    }
    expect(await saveVideo(db, o, guest, upload(), { now: after, dir, enqueue: false })).toEqual({ ok: false, error: 'tooMany' });
    db.update(outing).set({ status: 'cancelled' }).where(eq(outing.id, o.id)).run();
    expect(await saveVideo(db, { ...o, status: 'cancelled' }, guest, upload(), { now: after, dir, enqueue: false })).toEqual({ ok: false, error: 'closed' });
    // Rejected uploads leave no file behind.
    expect(readdirSync(dir).filter((f) => f.endsWith('.upload'))).toEqual([]);
  }, 120_000);
});

describe('rights, gallery and recap (#1693)', () => {
  it('auteur ou organisateur suppriment ; un autre invité non ; échec visible seulement de qui peut supprimer', async () => {
    const { db, o, guest, other, orga } = await setup();
    const ins = (status: 'ready' | 'failed', invitationId: string | null) => db.insert(outingVideo).values({ outingId: o.id, invitationId, authorUserId: invitationId ? null : 'u1', status, width: 1280, height: 720, durationMs: 4000 }).returning({ id: outingVideo.id }).get().id;
    const mine = ins('ready', 'i1');
    const failed = ins('failed', 'i1');
    const byId = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
    expect(listVideos(db, o.id, guest).map((v) => [v.id, v.mine, v.canDelete]).sort(byId)).toEqual([[mine, true, true], [failed, true, true]].sort(byId));
    expect(listVideos(db, o.id, other).map((v) => v.id)).toEqual([mine]);
    expect(listVideos(db, o.id, orga).map((v) => v.canDelete)).toEqual([true, true]);
    expect(deleteVideo(db, o, other, mine, dir)).toBe(false);
    expect(deleteVideo(db, o, orga, failed, dir)).toBe(true);
    expect(deleteVideo(db, o, guest, mine, dir)).toBe(true);
    expect(listVideos(db, o.id, orga)).toEqual([]);
  });
  it('résumé : vidéos prêtes seulement, placées par la position comme les photos', async () => {
    const { db, o, guest } = await setup();
    const { saveRide } = await import('@/lib/outings');
    const xml = `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${pts.map((p) => `<trkpt lat="${p[1]}" lon="${p[0]}"><ele>${p[2]}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
    expect((await saveRide(db, o, guest, xml, after, { elevation: false } as never)).ok).toBe(true);
    db.insert(outingVideo).values([
      { outingId: o.id, invitationId: 'i1', status: 'ready', width: 1280, height: 720, durationMs: 4000, lat: 43.2153, lon: 6.07 },
      { outingId: o.id, invitationId: 'i1', status: 'pending', width: 1280, height: 720, durationMs: 4000 },
    ]).run();
    const r = buildRecap(db, o, guest);
    expect(r.media).toHaveLength(1);
    expect(r.media[0]).toMatchObject({ type: 'video', durationMs: 4000, placement: { method: 'position' } });
  });
});
