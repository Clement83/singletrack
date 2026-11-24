import { getDb } from '@/db';
import { adminDenied, assertAdmin } from '@/lib/admin';
import { addRegion, deleteRegion, setAdminSwitch, setRegionEnabled } from '@/lib/offline/store';

export const dynamic = 'force-dynamic';

/** Admin (#1738). `{ catalog }` or `{ name, bbox }` registers a region (to build with `offline:build`). */
export async function POST(req: Request) {
  try { await assertAdmin(); } catch (e) { return adminDenied(e); }
  const body = (await req.json().catch(() => null)) as { catalog?: unknown; name?: unknown; bbox?: unknown } | null;
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
