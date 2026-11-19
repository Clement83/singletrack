/** Unread messages of the discussion (#1622): remembered per device (localStorage), never in the database. */
export const unreadKey = (id: string) => `outing-discussion:${id}`;

/** Messages from others after the last opening (no known opening ⇒ all of them). */
export function countUnread(comments: { createdAt: string; mine: boolean }[], lastOpenedAt: string | null): number {
  const last = lastOpenedAt ? Date.parse(lastOpenedAt) : NaN;
  return comments.filter((c) => !c.mine && (Number.isNaN(last) || Date.parse(c.createdAt) > last)).length;
}

export function readLastOpened(id: string): string | null {
  try { return localStorage.getItem(unreadKey(id)); } catch { return null; }
}

export function writeLastOpened(id: string, at = new Date()): void {
  try { localStorage.setItem(unreadKey(id), at.toISOString()); } catch { /* storage unavailable: the unread messages will come back */ }
}
