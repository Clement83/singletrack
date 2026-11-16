// Design system singletrack (#1363) : lecture de design/tokens.json, génération de
// src/app/styles/tokens.css et vérification des contrastes WCAG. Fonctions pures, testées
// dans tests/tokens.test.ts.

export type Theme = { id: string; name: string; scheme: 'light' | 'dark'; extends?: string; usage?: string };
type Named = { name: string; usage: string };
export type ColorToken = Named & { value: Record<string, string> };
export type ContrastRule = { fg: string; bg: string[]; min: number; usage: string };
export type TextToken = Named & {
  size: string;
  lineHeight: string;
  weight: number;
  letterSpacing?: string;
  sample: string;
};
export type ValueToken = Named & { value: string };
export type ThemedToken = Named & { value: Record<string, string> };

export type Tokens = {
  name: string;
  version: number;
  themes: Theme[];
  color: ColorToken[];
  contrast: ContrastRule[];
  font: ValueToken[];
  text: TextToken[];
  radius: ValueToken[];
  shadow: ThemedToken[];
  size: ValueToken[];
  motion: ValueToken[];
  map: ValueToken[];
};

export const GENERATED_HEADER =
  '/* FICHIER GÉNÉRÉ par `npm run tokens` depuis design/tokens.json : ne pas éditer à la main. */';

/** Valeur d'un token pour un thème, en suivant `extends` (ex. un thème d'essai → light) puis le schéma (dark → dark). */
export function resolveThemed(tokens: Tokens, value: Record<string, string>, themeId: string): string {
  const seen = new Set<string>();
  let id: string | undefined = themeId;
  while (id && !seen.has(id)) {
    seen.add(id);
    if (value[id] !== undefined) return value[id];
    id = tokens.themes.find((t) => t.id === id)?.extends;
  }
  const scheme = tokens.themes.find((t) => t.id === themeId)?.scheme ?? 'light';
  if (value[scheme] !== undefined) return value[scheme];
  throw new Error(`Aucune valeur pour le thème « ${themeId} » dans ${JSON.stringify(value)}`);
}

export function themeColors(tokens: Tokens, themeId: string): Record<string, string> {
  return Object.fromEntries(tokens.color.map((c) => [c.name, resolveThemed(tokens, c.value, themeId)]));
}

function themeBlock(tokens: Tokens, theme: Theme): string[] {
  const lines = [`  color-scheme: ${theme.scheme};`];
  for (const c of tokens.color) lines.push(`  --${c.name}: ${resolveThemed(tokens, c.value, theme.id)};`);
  for (const s of tokens.shadow) lines.push(`  --elevation-${s.name}: ${resolveThemed(tokens, s.value, theme.id)};`);
  return lines;
}

/** Feuille CSS complète : variables par thème + branchement Tailwind 4 (@theme). */
export function generateCss(tokens: Tokens): string {
  const [base, ...others] = tokens.themes;
  const out: string[] = [GENERATED_HEADER, ''];

  out.push(`/* Thème par défaut : ${base.name} */`, `:root,\n[data-theme='${base.id}'] {`, ...themeBlock(tokens, base), '}', '');
  for (const t of others) {
    out.push(`/* Thème ${t.name} */`, `[data-theme='${t.id}'] {`, ...themeBlock(tokens, t), '}', '');
  }
  const dark = tokens.themes.find((t) => t.scheme === 'dark');
  if (dark) {
    out.push(
      '/* Sans JS (ou avant hydratation) : suit le système. */',
      '@media (prefers-color-scheme: dark) {',
      '  :root:not([data-theme]) {',
      ...themeBlock(tokens, dark).map((l) => `  ${l}`),
      '  }',
      '}',
      '',
    );
    const darkIds = tokens.themes.filter((t) => t.scheme === 'dark').map((t) => `[data-theme='${t.id}']`);
    out.push(`@custom-variant dark (&:where(${darkIds.join(', ')}, ${darkIds.map((d) => `${d} *`).join(', ')}));`, '');
  }

  out.push('/* Valeurs indépendantes du thème. */', ':root {');
  for (const m of tokens.motion) out.push(`  --duration-${m.name}: ${m.value};`);
  for (const m of tokens.map) out.push(`  --map-${m.name}: ${m.value};`);
  out.push('}', '');

  // Branchement Tailwind : uniquement nos tokens (palette Tailwind par défaut désactivée).
  out.push('@theme inline {', '  --color-*: initial;');
  for (const c of tokens.color) out.push(`  --color-${c.name}: var(--${c.name});`);
  out.push('  --shadow-*: initial;');
  for (const s of tokens.shadow) out.push(`  --shadow-${s.name}: var(--elevation-${s.name});`);
  out.push('}', '');

  // static : toutes les variables sont émises, même inutilisées (lues par /styleguide et MapLibre).
  out.push('@theme static {');
  for (const f of tokens.font) out.push(`  --font-${f.name}: ${f.value};`);
  out.push('  --text-*: initial;');
  for (const t of tokens.text) {
    out.push(`  --text-${t.name}: ${t.size};`, `  --text-${t.name}--line-height: ${t.lineHeight};`);
    out.push(`  --text-${t.name}--font-weight: ${t.weight};`);
    if (t.letterSpacing) out.push(`  --text-${t.name}--letter-spacing: ${t.letterSpacing};`);
  }
  out.push('  --radius-*: initial;');
  for (const r of tokens.radius) out.push(`  --radius-${r.name}: ${r.value};`);
  for (const s of tokens.size) out.push(`  --spacing-${s.name}: ${s.value};`);
  out.push('  --default-transition-duration: var(--duration-fast);');
  out.push('}', '');
  return out.join('\n');
}

// --- Contrastes WCAG 2.x -------------------------------------------------------------

export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Couleur non hexadécimale à 6 chiffres : ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastResult = { theme: string; fg: string; bg: string; ratio: number; min: number; ok: boolean };

export function checkContrasts(tokens: Tokens): ContrastResult[] {
  const results: ContrastResult[] = [];
  for (const theme of tokens.themes) {
    const colors = themeColors(tokens, theme.id);
    for (const rule of tokens.contrast) {
      for (const bg of rule.bg) {
        if (!(rule.fg in colors) || !(bg in colors)) throw new Error(`Token inconnu dans contrast : ${rule.fg} / ${bg}`);
        const ratio = contrastRatio(colors[rule.fg], colors[bg]);
        results.push({ theme: theme.id, fg: rule.fg, bg, ratio, min: rule.min, ok: ratio >= rule.min });
      }
    }
  }
  return results;
}
