import { getDb } from '@/db';
import { LIMITS, logRefusal, screenInbox } from './moderation';

/** Boîtes d'entrée : `/ap/inbox` (partagée) et `/ap/users/<handle>/inbox`. */
export const isInboxRequest = (req: { method: string }, pathname: string) =>
  req.method === 'POST' && (pathname === '/ap/inbox' || /^\/ap\/users\/[^/]+\/inbox$/.test(pathname));

/**
 * Filtre précoce des activités reçues (#1477), avant Fedify : taille (256 Ko), serveur bloqué, débit par serveur (60/min),
 * `Delete` d'un acteur inconnu. Retourne soit une réponse de refus, soit la requête à passer à Fedify (corps relu une seule fois).
 * L'acteur est ici **déclaré** (non vérifié) ; les signatures et l'horloge (±12 h) sont vérifiées ensuite par Fedify, et un refus
 * de signature (401) est journalisé.
 */
export async function guardInbox(req: Request): Promise<{ response: Response } | { request: Request; domain: string | null }> {
  const { db } = getDb();
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > LIMITS.maxActivityBytes) {
    logRefusal(db, { reason: 'too_large' });
    return { response: new Response(null, { status: 413 }) };
  }
  // Lecture bornée : un corps sans Content-Length (chunked) ne dépasse jamais la limite en mémoire.
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
  try { body = JSON.parse(bytes.toString('utf8')); } catch { /* Fedify répondra 400 */ }
  const v = screenInbox(db, { size, body });
  if (!v.ok) {
    logRefusal(db, { domain: v.domain, reason: v.reason, activity: typeof (body as { type?: unknown } | null)?.type === 'string' ? (body as { type: string }).type : null });
    return { response: new Response(null, { status: v.status }) };
  }
  const request = new Request(req.url, { method: req.method, headers: req.headers, body: bytes });
  return { request, domain: v.domain };
}

/** Journalise un refus de signature / d'horloge de Fedify (401) ou une activité invalide (400). */
export function logFedifyRefusal(domain: string | null, status: number) {
  if (status !== 401 && status !== 400) return;
  logRefusal(getDb().db, { domain, reason: status === 401 ? 'signature' : 'invalid' });
}
