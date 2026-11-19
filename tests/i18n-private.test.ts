import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fr from '../messages/fr.json';
import en from '../messages/en.json';

// #1402: routes and server logic return error codes, translated on the client (`errors.<code>`).
const read = (f: string) => readFileSync(path.join(__dirname, '..', f), 'utf8');
const SOURCES = [
  'src/lib/outings/service.ts',
  'src/lib/tracks/import.ts',
  'src/lib/tracks/edit.ts',
  'src/lib/geo/gpx.ts',
  'src/app/api/tracks/import/route.ts',
];

describe('codes d’erreur serveur traduits (#1402)', () => {
  const codes = new Set<string>();
  for (const f of SOURCES) {
    const s = read(f);
    for (const m of s.matchAll(/errors\.\w+ = '(\w+)'/g)) codes.add(m[1]);
    for (const m of s.matchAll(/errors: \{ \w+: '(\w+)' \}/g)) codes.add(m[1]);
    for (const m of s.matchAll(/new Error\('(\w+)'\)/g)) codes.add(m[1]);
    for (const m of s.matchAll(/error: '(\w+)'/g)) codes.add(m[1]);
  }
  it('trouve les codes', () => expect(codes.size).toBeGreaterThan(20));
  it.each([...codes].filter((c) => !['not_found', 'invalid', 'closed', 'full', 'disabled', 'forbidden'].includes(c)))('%s existe en fr et en', (c) => {
    expect((fr.errors as Record<string, string>)[c]).toBeTruthy();
    expect((en.errors as Record<string, string>)[c]).toBeTruthy();
  });
  it('aucune phrase française dans ces fichiers serveur', () => {
    for (const f of SOURCES) expect(read(f).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')).not.toMatch(/'[^'\n]*[éèàç][^'\n]*'/);
  });
});

describe('codes d’erreur copains (#1432)', () => {
  const src = read('src/lib/friends.ts') + read('src/app/api/friends/route.ts') + read('src/app/api/friends/[id]/route.ts');
  const codes = [...src.matchAll(/error: '(\w+)'/g)].map((m) => m[1]).filter((c) => !['not_found', 'invalid'].includes(c));
  it.each([...new Set(codes)])('%s existe en fr et en', (c) => {
    expect((fr.errors as Record<string, string>)[c]).toBeTruthy();
    expect((en.errors as Record<string, string>)[c]).toBeTruthy();
  });
});
