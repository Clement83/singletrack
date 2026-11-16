import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { remoteActor } from '@/db/schema';

export type RemoteActorInput = {
  actorUrl: string;
  handle: string;
  displayName?: string | null;
  inboxUrl: string;
  sharedInboxUrl?: string | null;
  publicKeyPem?: string | null;
};

/** Cache d'un compte distant (#1474) : création ou mise à jour par URL d'acteur. Jamais d'email. Le domaine vient de l'URL. */
export function upsertRemoteActor(db: Db, input: RemoteActorInput, now = new Date()) {
  const url = new URL(input.actorUrl);
  const values = {
    handle: input.handle,
    domain: url.host,
    displayName: input.displayName ?? null,
    inboxUrl: input.inboxUrl,
    sharedInboxUrl: input.sharedInboxUrl ?? null,
    publicKeyPem: input.publicKeyPem ?? null,
    fetchedAt: now,
  };
  db.insert(remoteActor).values({ id: randomUUID(), actorUrl: url.href, ...values }).onConflictDoUpdate({ target: remoteActor.actorUrl, set: values }).run();
  return db.select().from(remoteActor).where(eq(remoteActor.actorUrl, url.href)).get()!;
}

export function getRemoteActor(db: Db, actorUrl: string) {
  return db.select().from(remoteActor).where(eq(remoteActor.actorUrl, actorUrl)).get() ?? null;
}
