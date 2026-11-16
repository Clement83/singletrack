/**
 * Configuration de la fédération (#1474). `FEDERATION=on|off` : `off` ⇒ aucune route ActivityPub ne répond et rien ne part.
 * **Activée par défaut** (#1477, protections livrées) : sans `FEDERATION`, elle est `on` dès que la clé d'instance
 * `FEDERATION_KEY_ENC` existe (`scripts/init-env.sh` la génère) ; sans clé, elle reste éteinte (l'instance démarre quand même,
 * un avertissement est journalisé). `FEDERATION=on` explicite exige la clé (démarrage refusé sinon). Le domaine vient de la
 * configuration, jamais d'un en-tête de requête.
 */
export function federationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.FEDERATION?.trim().toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return !!env.FEDERATION_KEY_ENC?.trim();
}

/** `FEDERATION` non renseignée ET pas de clé : fédération éteinte par défaut, à signaler au démarrage. */
export const federationImplicitlyOff = (env: NodeJS.ProcessEnv = process.env) => !env.FEDERATION?.trim() && !env.FEDERATION_KEY_ENC?.trim();

/** Origine publique de l'instance (`https://domaine`, sans slash final). */
export function publicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PUBLIC_URL || env.BETTER_AUTH_URL || 'http://localhost:3000';
  return new URL(raw).origin;
}

/** Domaine de l'instance (hôte, avec le port s'il n'est pas standard) : partie droite de `handle@domaine`. */
export function instanceDomain(env: NodeJS.ProcessEnv = process.env): string {
  return new URL(publicOrigin(env)).host;
}

export const fedAddress = (handle: string, env: NodeJS.ProcessEnv = process.env) => `${handle}@${instanceDomain(env)}`;
