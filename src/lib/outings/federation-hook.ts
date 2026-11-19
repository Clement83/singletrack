import type { Db } from '@/db';
import { federationEnabled } from '@/lib/federation/config';

/**
 * Bridge between outings and federation (#1476). Called after every change of an outing; no effect if
 * `FEDERATION=off`. Dynamic import: `federation/outings` imports the outings service (no static cycle),
 * and delivery happens in the background (Fedify's queue retries) without ever failing the user's action.
 */
const run = (what: string, fn: () => Promise<unknown>) => {
  if (!federationEnabled()) return;
  void fn().catch((e) => console.warn(`[federation] ${what}`, e instanceof Error ? e.message : e));
};

/** Creation or change (status, track, visibility…): `Create` / `Update(Event)` to the servers concerned. */
export function emitOutingChange(db: Db, outingId: string, verb: 'Create' | 'Update'): void {
  run('sortie', async () => (await import('@/lib/federation/outings')).publishOuting(db, outingId, verb));
}

/** Remote friends invited from an outing (`remote:<id>` accepted by `inviteFriends`): the `Event` goes to their server only. */
export function emitRemoteInvites(db: Db, outingId: string, remoteActorIds: string[]): void {
  run('invitation distante', async () => (await import('@/lib/federation/outings')).publishToActors(db, outingId, remoteActorIds));
}

/** Remote guest removed: `Delete(Event)` to their server, which removes the outing on its side. */
export function emitRemoteRetract(db: Db, outingId: string, remoteActorId: string): void {
  run('retrait invité distant', async () => (await import('@/lib/federation/outings')).retractFromActor(db, outingId, remoteActorId));
}
