import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fr from '../messages/fr.json';

// #1405 : chaque zone n'envoie au navigateur que ses namespaces. Ce test parcourt les imports depuis les pages
// de chaque zone et vérifie que tout namespace utilisé par un composant **client** est bien envoyé.
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const src = readFileSync(path.join(SRC, 'i18n/client-messages.tsx'), 'utf8');

/** Lit CLIENT_NAMESPACES sans exécuter le module (il importe next-intl/server). */
function zones(): Record<string, string[] | 'all'> {
  const consts: Record<string, string[]> = {};
  for (const m of src.matchAll(/const (\w+): Ns\[\] = \[([^\]]*)\]/g)) consts[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  const body = src.slice(src.indexOf('CLIENT_NAMESPACES = {'), src.indexOf('} satisfies'));
  const out: Record<string, string[] | 'all'> = {};
  for (const m of body.matchAll(/(\w+): (\[[\s\S]*?\]|'all'|[A-Z]+)/g)) {
    if (m[2] === "'all'") { out[m[1]] = 'all'; continue; }
    if (/^[A-Z]+$/.test(m[2])) { out[m[1]] = consts[m[2]]; continue; }
    const list: string[] = [];
    for (const s of m[2].matchAll(/\.\.\.(\w+)/g)) list.push(...consts[s[1]]);
    for (const s of m[2].matchAll(/'(\w+)'/g)) list.push(s[1]);
    out[m[1]] = list;
  }
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Namespaces des composants client atteints depuis `entries` (un fichier serveur importé par un client devient client). */
function clientNamespaces(entries: string[]): Set<string> {
  const ns = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string, client: boolean) => {
    const key = `${file}:${client}`;
    if (seen.has(key)) return;
    seen.add(key);
    const s = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    const isClient = client || /^['"]use client['"]/m.test(s);
    if (isClient) {
      for (const m of s.matchAll(/useTranslations\('(\w+)'\)/g)) ns.add(m[1]);
      if (/useTranslations\(\)/.test(s)) for (const m of s.matchAll(/\bt\('(\w+)\./g)) ns.add(m[1]);
      if (/useErrorText\(/.test(s)) ns.add('errors');
    }
    // Les `import type` ne livrent aucun code au navigateur.
    const code = s.replace(/^import type [^;]+;$/gm, '').replace(/^export type [^;]+;$/gm, '');
    for (const m of code.matchAll(/(?:import|from)\s*\(?\s*'([^']+)'/g)) {
      const r = resolve(file, m[1]);
      if (r && !r.endsWith('.json')) visit(r, isClient);
    }
  };
  entries.forEach((e) => visit(e, false));
  return ns;
}

const pagesUnder = (dir: string, skip: string[] = []): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (skip.some((s) => p.includes(s))) return [];
    return statSync(p).isDirectory() ? pagesUnder(p, skip) : /^(page|layout)\.tsx$/.test(f) ? [p] : [];
  });

const A = (p: string) => path.join(SRC, 'app', p);
const ROUTES: Record<string, string[]> = {
  root: [A('layout.tsx'), A('offline/page.tsx')],
  auth: [...pagesUnder(A('login')), ...pagesUnder(A('bienvenue'))],
  track: [A('t/[slug]/page.tsx')],
  editor: [A('t/[slug]/edit/page.tsx')],
  guest: pagesUnder(A('i')),
  outing: pagesUnder(A('s')),
  private: pagesUnder(A('(private)'), ['styleguide']),
};

describe('messages client par zone (#1405)', () => {
  const z = zones();
  it('zones lues', () => expect(Object.keys(z)).toEqual(expect.arrayContaining(Object.keys(ROUTES))));
  it.each(Object.entries(ROUTES))('%s : tous les namespaces client utilisés sont envoyés', (zone, entries) => {
    const sent = z[zone];
    const needed = [...clientNamespaces(entries)];
    if (sent === 'all') return;
    expect(needed.filter((n) => !sent.includes(n))).toEqual([]);
  });
  it('les namespaces des zones existent', () => {
    for (const list of Object.values(z)) if (list !== 'all') for (const n of list) expect(fr).toHaveProperty(n);
  });
});
