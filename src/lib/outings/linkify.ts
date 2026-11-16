export type Part = { text: string; href?: string };

const URL_RE = /https?:\/\/[^\s<>"]+/gi;

/** Découpe un texte brut en morceaux texte / lien. Aucun HTML : l'affichage passe par React (échappé). */
export function linkify(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    // La ponctuation finale appartient à la phrase, pas au lien.
    const trail = url.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    url = url.slice(0, url.length - trail.length);
    const i = m.index!;
    if (i > last) parts.push({ text: text.slice(last, i) });
    try {
      new URL(url);
      parts.push({ text: url, href: url });
    } catch {
      parts.push({ text: url });
    }
    last = i + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
