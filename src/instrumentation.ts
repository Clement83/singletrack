// Run once at server start-up: opens the database and applies the migrations.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Encrypted personal links (#1456): refuses to start in production without a valid INVITE_LINK_KEY.
    (await import('./lib/outings/tokens')).assertInviteKey();
    const { getDb } = await import('./db');
    const { sourceEnabled } = await import('./lib/config');
    const { db } = getDb();
    // Federation (#1474): handles of existing accounts, and instance key required if federation is on.
    (await import('./lib/federation/handle')).backfillHandles(db);
    const fed = await import('./lib/federation/config');
    if (fed.federationEnabled()) (await import('./lib/federation/crypto')).federationKey();
    else if (fed.federationImplicitlyOff()) console.warn('[federation] FEDERATION_KEY_ENC absente : fédération éteinte (openssl rand -base64 32, ou ./scripts/init-env.sh)');
    // Fire risk levels (#1349): outlines if missing, then today's and tomorrow's files (1 call/day max).
    if (process.env.FIRE_SCHEDULER !== 'off' && sourceEnabled('fire83')) (await import('./lib/fire/refresh')).startFireScheduler(db);
  }
}
