// Exécuté une fois au démarrage du serveur : ouvre la base et applique les migrations.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Liens perso chiffrés (#1456) : refuse de démarrer en production sans INVITE_LINK_KEY valide.
    (await import('./lib/outings/tokens')).assertInviteKey();
    const { getDb } = await import('./db');
    const { sourceEnabled } = await import('./lib/config');
    const { db } = getDb();
    // Fédération (#1474) : handles des comptes existants, et clé d'instance obligatoire si la fédération est active.
    (await import('./lib/federation/handle')).backfillHandles(db);
    const fed = await import('./lib/federation/config');
    if (fed.federationEnabled()) (await import('./lib/federation/crypto')).federationKey();
    else if (fed.federationImplicitlyOff()) console.warn('[federation] FEDERATION_KEY_ENC absente : fédération éteinte (openssl rand -base64 32, ou ./scripts/init-env.sh)');
    // Niveaux de risque incendie (#1349) : contours si absents, puis fichiers du jour et du lendemain (1 appel/jour max).
    if (process.env.FIRE_SCHEDULER !== 'off' && sourceEnabled('fire83')) (await import('./lib/fire/refresh')).startFireScheduler(db);
  }
}
