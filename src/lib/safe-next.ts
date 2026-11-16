/** Retour après connexion (#1434) : uniquement la page d'un lien invité `/i/<token>`, jamais une URL libre (pas de redirection ouverte). */
export function safeNext(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/i\/[A-Za-z0-9_-]{20,100}$/.test(value) ? value : undefined;
}
