import type { Db } from '@/db';
import { federationEnabled } from '@/lib/federation/config';

/**
 * Pont entre les sorties et la fédération (#1476). Appelé après chaque changement d'une sortie ; sans effet si
 * `FEDERATION=off`. Import dynamique : `federation/outings` importe le service des sorties (pas de cycle statique),
 * et l'envoi part en arrière-plan (la file de Fedify fait les réessais) sans jamais faire échouer l'action de l'utilisateur.
 */
const run = (what: string, fn: () => Promise<unknown>) => {
  if (!federationEnabled()) return;
  void fn().catch((e) => console.warn(`[federation] ${what}`, e instanceof Error ? e.message : e));
};

/** Création ou modification (statut, trace, visibilité…) : `Create` / `Update(Event)` vers les serveurs concernés. */
export function emitOutingChange(db: Db, outingId: string, verb: 'Create' | 'Update'): void {
  run('sortie', async () => (await import('@/lib/federation/outings')).publishOuting(db, outingId, verb));
}

/** Copains distants invités depuis une sortie (`remote:<id>` accepté par `inviteFriends`) : l'`Event` part à leur serveur seulement. */
export function emitRemoteInvites(db: Db, outingId: string, remoteActorIds: string[]): void {
  run('invitation distante', async () => (await import('@/lib/federation/outings')).publishToActors(db, outingId, remoteActorIds));
}

/** Invité distant retiré : `Delete(Event)` vers son serveur, il retire la sortie de chez lui. */
export function emitRemoteRetract(db: Db, outingId: string, remoteActorId: string): void {
  run('retrait invité distant', async () => (await import('@/lib/federation/outings')).retractFromActor(db, outingId, remoteActorId));
}
