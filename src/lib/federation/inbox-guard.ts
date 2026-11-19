import { getDb } from '@/db';
import { LIMITS, logRefusal, screenInbox } from './moderation';

/** Inboxes: `/ap/inbox` (shared) and `/ap/users/<handle>/inbox`. */
export const isInboxRequest = (req: { method: string }, pathname: string) =>
  req.method === 'POST' && (pathname === '/ap/inbox' || /^\/ap\/users\/[^/]+\/inbox$/.test(pathname));

/**
 * Early filter of received activities (#1477), before Fedify: size (256 KB), blocked server, rate per server (60/min),
 * `Delete` from an unknown actor. Returns either a rejection response, or the request to pass to Fedify (body read only once).
 * The actor here is **declared** (not verified); signatures and clock (±12 h) are then verified by Fedify, and a signature
 * rejection (401) is logged.
 */
export async function guardInbox(req: Request): Promise<{ response: Response } | { request: Request; domain: string | null }> {
  const { db } = getDb();
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > LIMITS.maxActivityBytes) {
    logRefusal(db, { reason: 'too_large' });
    return { response: new Response(null, { status: 413 }) };
  }
  // Bounded read: a body without Content-Length (chunked) never exceeds the limit in memory.
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.maxActivityBytes) {
      await reader.cancel().catch(() => {});
      logRefusal(db, { reason: 'too_large' });
      return { response: new Response(null, { status: 413 }) };
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  let body: unknown = null;
  try { body = JSON.parse(bytes.toString('utf8')); } catch { /* Fedify will answer 400 */ }
  const v = screenInbox(db, { size, body });
  if (!v.ok) {
    logRefusal(db, { domain: v.domain, reason: v.reason, activity: typeof (body as { type?: unknown } | null)?.type === 'string' ? (body as { type: string }).type : null });
    return { response: new Response(null, { status: v.status }) };
  }
  const request = new Request(req.url, { method: req.method, headers: req.headers, body: bytes });
  return { request, domain: v.domain };
}

/** Logs a Fedify signature / clock rejection (401) or an invalid activity (400). */
export function logFedifyRefusal(domain: string | null, status: number) {
  if (status !== 401 && status !== 400) return;
  logRefusal(getDb().db, { domain, reason: status === 401 ? 'signature' : 'invalid' });
}
