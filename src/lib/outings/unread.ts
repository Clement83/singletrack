/** Non-lus de la discussion (#1622) : mémorisés par appareil (localStorage), jamais en base. */
export const unreadKey = (id: string) => `outing-discussion:${id}`;

/** Messages d'autrui postérieurs à la dernière ouverture (aucune ouverture connue ⇒ tous). */
export function countUnread(comments: { createdAt: string; mine: boolean }[], lastOpenedAt: string | null): number {
  const last = lastOpenedAt ? Date.parse(lastOpenedAt) : NaN;
  return comments.filter((c) => !c.mine && (Number.isNaN(last) || Date.parse(c.createdAt) > last)).length;
}

export function readLastOpened(id: string): string | null {
  try { return localStorage.getItem(unreadKey(id)); } catch { return null; }
}

export function writeLastOpened(id: string, at = new Date()): void {
  try { localStorage.setItem(unreadKey(id), at.toISOString()); } catch { /* stockage indisponible : les non-lus reviendront */ }
}
