export type Part = { text: string; href?: string };

const URL_RE = /https?:\/\/[^\s<>"]+/gi;

/** Splits a raw text into text / link pieces. No HTML: rendering goes through React (escaped). */
export function linkify(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    // Trailing punctuation belongs to the sentence, not to the link.
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
