import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { checkContrasts, contrastRatio, generateCss, resolveThemed, type Tokens } from '../scripts/tokens/lib';

// Design system (#1363) : tokens source unique, contrastes WCAG, règle anti-couleur en dur.
const root = path.resolve(__dirname, '..');
const tokens = JSON.parse(readFileSync(path.join(root, 'design/tokens.json'), 'utf8')) as Tokens;

describe('tokens : contrastes WCAG', () => {
  it('calcule le ratio WCAG (noir/blanc = 21)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  for (const theme of tokens.themes) {
    it(`thème ${theme.id} : tous les couples déclarés passent (AA texte 4.5, UI 3)`, () => {
      const failures = checkContrasts(tokens)
        .filter((r) => r.theme === theme.id && !r.ok)
        .map((r) => `${r.fg} sur ${r.bg} = ${r.ratio.toFixed(2)} < ${r.min}`);
      expect(failures).toEqual([]);
    });
  }

  it('chaque couleur a une valeur pour chaque thème (directe, extends ou schéma)', () => {
    for (const t of tokens.themes) for (const c of tokens.color) expect(() => resolveThemed(tokens, c.value, t.id)).not.toThrow();
  });

  it('chaque token a une note d’usage', () => {
    const all = [tokens.color, tokens.text, tokens.radius, tokens.shadow, tokens.size, tokens.motion, tokens.map, tokens.font].flat();
    expect(all.filter((t) => !t.usage).map((t) => t.name)).toEqual([]);
  });
});

describe('tokens : génération', () => {
  it('src/app/styles/tokens.css est à jour (sinon : npm run tokens)', () => {
    const current = readFileSync(path.join(root, 'src/app/styles/tokens.css'), 'utf8');
    expect(current).toBe(generateCss(tokens));
  });

  it('changer primary dans tokens.json change la variable de tous les thèmes qui en héritent', () => {
    const edited = structuredClone(tokens);
    // Thème d'essai qui hérite du clair (le mécanisme `extends` reste disponible, #1396 a retiré « garrigue »).
    edited.themes.push({ id: 'essai', name: 'Essai', scheme: 'light', extends: 'light', usage: 'test' });
    const primary = edited.color.find((c) => c.name === 'primary')!;
    primary.value.light = '#123456';
    const css = generateCss(edited);
    // light + essai (extends light)
    expect(css.match(/--primary: #123456;/g)).toHaveLength(2);
    expect(css).toContain('--color-primary: var(--primary);');
  });

  it('deux thèmes seulement : clair et sombre (#1396)', () => {
    expect(tokens.themes.map((t) => t.id)).toEqual(['light', 'dark']);
  });

  it('expose les noms shadcn/ui et désactive la palette Tailwind par défaut', () => {
    const css = generateCss(tokens);
    for (const v of ['background', 'foreground', 'primary', 'primary-foreground', 'muted-foreground', 'border', 'input', 'ring']) {
      expect(css).toContain(`--color-${v}: var(--${v});`);
    }
    expect(css).toContain('--color-*: initial;');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(css).toContain("[data-theme='dark']");
  });
});

// Le premier lintText charge la config ESLint et le parseur TypeScript (plusieurs secondes sur une machine
// chargée) : préchauffage dans un beforeAll au délai long, puis marge raisonnable par test (#1404).
describe('règle anti-couleur en dur', { timeout: 20_000 }, () => {
  const eslint = new ESLint({ cwd: root });
  const lint = async (code: string) =>
    (await eslint.lintText(code, { filePath: path.join(root, 'src/app/_probe.tsx') }))[0].messages.filter(
      (m) => m.ruleId === 'no-restricted-syntax',
    ).length;

  beforeAll(async () => {
    await lint('export const warmup = 1;');
  }, 60_000);

  it('refuse hex, rgb(), valeurs arbitraires et palette Tailwind', async () => {
    expect(await lint(`export const a = { color: '#2d6a4c' };`)).toBeGreaterThan(0);
    expect(await lint(`export const a = 'rgba(0, 0, 0, 0.5)';`)).toBeGreaterThan(0);
    expect(await lint(`export const a = 'p-4 bg-[#fff]';`)).toBeGreaterThan(0);
    expect(await lint(`export const a = 'p-4 text-red-500';`)).toBeGreaterThan(0);
    expect(await lint('export const a = `hover:bg-white ${1}`;')).toBeGreaterThan(0);
  });

  it('accepte les tokens', async () => {
    expect(await lint(`export const a = 'bg-primary text-primary-foreground bg-diff-green ring-ring';`)).toBe(0);
    expect(await lint('export const a = { background: `var(--primary)` };')).toBe(0);
  });

  it('aucune couleur en dur dans les CSS hors tokens.css généré', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.css') ? [p] : [];
      });
    const offenders = walk(path.join(root, 'src'))
      .filter((f) => !f.endsWith(path.join('styles', 'tokens.css')))
      .filter((f) => /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch)\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
