import { getDb } from '@/db';
import { adminDenied, assertAdmin } from '@/lib/admin';
import { enqueueJob } from '@/lib/offline/jobs';
import { addRegion, deleteRegion, setAdminSwitch, setRegionEnabled } from '@/lib/offline/store';

export const dynamic = 'force-dynamic';

/**
 * Admin (#1738). `{ catalog }` or `{ name, bbox }` registers a region. `{ build: id }` / `{ refresh: true }` enqueue a job
 * for the `offline-worker` service (#1749): 404 unknown region, 409 `offlineBusy` when the same job is already queued/running.
 */
export async function POST(req: Request) {
  let me;
  try { me = await assertAdmin(); } catch (e) { return adminDenied(e); }
  const body = (await req.json().catch(() => null)) as { catalog?: unknown; name?: unknown; bbox?: unknown; build?: unknown; refresh?: unknown } | null;
  if (typeof body?.build === 'string' || body?.refresh === true) {
    const r = typeof body.build === 'string'
      ? enqueueJob(getDb().db, { kind: 'build', regionId: body.build, userId: me.id })
      : enqueueJob(getDb().db, { kind: 'refresh', userId: me.id });
    if ('error' in r) return r.error === 'busy' ? Response.json({ error: 'offlineBusy' }, { status: 409 }) : Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ ok: true, job: r.job.id });
  }
  const r = addRegion(getDb().db, body ?? {});
  if ('error' in r) return Response.json({ error: r.error === 'exists' ? 'offlineExists' : 'offlineInvalid' }, { status: r.error === 'exists' ? 409 : 422 });
  return Response.json({ ok: true, id: r.region.id });
}

/** Admin. `{ id, enabled }` enables/disables a built region; `{ switch }` sets the master switch. */
export async function PATCH(req: Request) {
  try { await assertAdmin(); } catch (e) { return adminDenied(e); }
  const body = (await req.json().catch(() => null)) as { id?: unknown; enabled?: unknown; switch?: unknown } | null;
  const { db } = getDb();
  if (typeof body?.switch === 'boolean') { setAdminSwitch(db, body.switch); return Response.json({ ok: true }); }
  if (typeof body?.id !== 'string' || typeof body.enabled !== 'boolean') return Response.json({ error: 'offlineInvalid' }, { status: 422 });
  const r = setRegionEnabled(db, body.id, body.enabled);
  if (r === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 });
  if (r === 'not_built') return Response.json({ error: 'offlineNotBuilt' }, { status: 409 });
  return Response.json({ ok: true });
}

/** Admin. `{ id }` deletes a region and its file. */
export async function DELETE(req: Request) {
  try { await assertAdmin(); } catch (e) { return adminDenied(e); }
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  return typeof body?.id === 'string' && deleteRegion(getDb().db, body.id) ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
}
