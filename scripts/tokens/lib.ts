// Design system singletrack (#1363) : lecture de design/tokens.json, génération de
// src/app/styles/tokens.css et vérification des contrastes WCAG. Fonctions pures, testées
// dans tests/tokens.test.ts.

export type Theme = { id: string; name: string; scheme: 'light' | 'dark'; extends?: string; usage?: string };
type Named = { name: string; usage: string };
/** Valeur d'un token : une chaîne (tous thèmes) ou une valeur par thème / schéma (`light`, `dark`). */
export type Value = string | Record<string, string>;
/** Charte graphique (#1624) : axe indépendant du clair/sombre. `extends` : hérite d'une autre charte (défaut : la première). */
export type Charte = { id: string; name: string; extends?: string; usage?: string };
/** Surcharges par charte : `{ "<charte>": <valeur> }` ; absent = hérite (Classique en dernier recours). */
type ByCharte<T> = { chartes?: Record<string, T> };
export type ColorToken = Named & ByCharte<Value> & { value: Record<string, string> };
export type ContrastRule = { fg: string; bg: string[]; min: number; usage: string };
type TextFields = { size: string; lineHeight: string; weight: number; letterSpacing?: string };
export type TextToken = Named & TextFields & ByCharte<Partial<TextFields>> & { sample: string };
export type ValueToken = Named & ByCharte<Value> & { value: Value };
export type ThemedToken = Named & ByCharte<Value> & { value: Record<string, string> };

export type Tokens = {
  name: string;
  version: number;
  themes: Theme[];
  chartes: Charte[];
  color: ColorToken[];
  contrast: ContrastRule[];
  font: ValueToken[];
  text: TextToken[];
  radius: ValueToken[];
  shadow: ThemedToken[];
  surface: ValueToken[];
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

/** Chaîne d'héritage d'une charte : elle-même, ses parents, puis la charte de base (Classique). */
function charteChain(tokens: Tokens, charteId: string): string[] {
  const chain: string[] = [];
  let id: string | undefined = charteId;
  while (id && !chain.includes(id)) {
    chain.push(id);
    id = tokens.chartes.find((c) => c.id === id)?.extends;
  }
  const base = tokens.chartes[0].id;
  if (!chain.includes(base)) chain.push(base);
  return chain;
}

/** Valeur effective d'un token pour une charte × un thème : surcharge de charte la plus proche, sinon valeur de base. */
export function resolveValue(tokens: Tokens, token: { value: Value; chartes?: Record<string, Value> }, themeId: string, charteId: string): string {
  for (const c of charteChain(tokens, charteId)) {
    const o = token.chartes?.[c];
    if (o !== undefined) return typeof o === 'string' ? o : resolveThemed(tokens, o, themeId);
  }
  return typeof token.value === 'string' ? token.value : resolveThemed(tokens, token.value, themeId);
}

function resolveText(tokens: Tokens, t: TextToken, charteId: string): TextFields {
  const out: TextFields = { size: t.size, lineHeight: t.lineHeight, weight: t.weight, letterSpacing: t.letterSpacing };
  for (const c of charteChain(tokens, charteId).reverse()) Object.assign(out, t.chartes?.[c]);
  return out;
}

/** Toutes les variables CSS qui dépendent de la charte et/ou du thème, pour un couple donné. */
export function charteThemeVars(tokens: Tokens, charteId: string, themeId: string): Record<string, string> {
  const v: Record<string, string> = {};
  for (const c of tokens.color) v[`--${c.name}`] = resolveValue(tokens, c, themeId, charteId);
  for (const s of tokens.shadow) v[`--elevation-${s.name}`] = resolveValue(tokens, s, themeId, charteId);
  for (const s of tokens.surface) v[`--${s.name}`] = resolveValue(tokens, s, themeId, charteId);
  for (const f of tokens.font) v[`--font-${f.name}`] = resolveValue(tokens, f, themeId, charteId);
  for (const r of tokens.radius) v[`--radius-${r.name}`] = resolveValue(tokens, r, themeId, charteId);
  for (const t of tokens.text) {
    const f = resolveText(tokens, t, charteId);
    v[`--text-${t.name}`] = f.size;
    v[`--text-${t.name}--line-height`] = f.lineHeight;
    v[`--text-${t.name}--font-weight`] = String(f.weight);
    if (f.letterSpacing) v[`--text-${t.name}--letter-spacing`] = f.letterSpacing;
  }
  return v;
}

/** Variables du thème d'une charte, hors celles déclarées ailleurs (@theme static) pour la charte de base. */
const THEME_VAR = /^--(?!font-|radius-|text-)/;

function themeBlock(tokens: Tokens, theme: Theme): string[] {
  const vars = charteThemeVars(tokens, tokens.chartes[0].id, theme.id);
  return [`  color-scheme: ${theme.scheme};`, ...Object.entries(vars).filter(([k]) => THEME_VAR.test(k)).map(([k, x]) => `  ${k}: ${x};`)];
}

/** Blocs d'une charte non-base : par thème, seules les variables qui diffèrent de la charte de base. */
function charteBlocks(tokens: Tokens, charte: Charte): string[] {
  const out: string[] = [];
  const base = tokens.chartes[0].id;
  const diff = (theme: Theme) => {
    const b = charteThemeVars(tokens, base, theme.id);
    const c = charteThemeVars(tokens, charte.id, theme.id);
    return Object.entries(c).filter(([k, x]) => b[k] !== x).map(([k, x]) => `  ${k}: ${x};`);
  };
  const dark = tokens.themes.find((t) => t.scheme === 'dark');
  tokens.themes.forEach((t, i) => {
    const lines = diff(t);
    if (!lines.length) return;
    const sel = [`[data-charte='${charte.id}'][data-theme='${t.id}']`];
    if (i === 0) sel.push(`:root[data-charte='${charte.id}']:not([data-theme])`);
    out.push(`${sel.join(',\n')} {`, ...lines, '}', '');
  });
  if (dark) {
    const lines = diff(dark);
    if (lines.length) {
      out.push('@media (prefers-color-scheme: dark) {', `  :root[data-charte='${charte.id}']:not([data-theme]) {`, ...lines.map((l) => `  ${l}`), '  }', '}', '');
    }
  }
  return out;
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

  for (const c of tokens.chartes.slice(1)) {
    const blocks = charteBlocks(tokens, c);
    if (blocks.length) out.push(`/* Charte ${c.name} (#1624) : seulement ce qui change par rapport à ${tokens.chartes[0].name}. */`, ...blocks);
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
  for (const f of tokens.font) out.push(`  --font-${f.name}: ${resolveValue(tokens, f, tokens.themes[0].id, tokens.chartes[0].id)};`);
  out.push('  --text-*: initial;');
  for (const t of tokens.text) {
    out.push(`  --text-${t.name}: ${t.size};`, `  --text-${t.name}--line-height: ${t.lineHeight};`);
    out.push(`  --text-${t.name}--font-weight: ${t.weight};`);
    if (t.letterSpacing) out.push(`  --text-${t.name}--letter-spacing: ${t.letterSpacing};`);
  }
  out.push('  --radius-*: initial;');
  for (const r of tokens.radius) out.push(`  --radius-${r.name}: ${resolveValue(tokens, r, tokens.themes[0].id, tokens.chartes[0].id)};`);
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

export type ContrastResult = { charte: string; theme: string; fg: string; bg: string; ratio: number; min: number; ok: boolean };

export function checkContrasts(tokens: Tokens): ContrastResult[] {
  const results: ContrastResult[] = [];
  for (const charte of tokens.chartes) {
    for (const theme of tokens.themes) {
      const vars = charteThemeVars(tokens, charte.id, theme.id);
      const colors = Object.fromEntries(tokens.color.map((c) => [c.name, vars[`--${c.name}`]]));
      for (const rule of tokens.contrast) {
        for (const bg of rule.bg) {
          if (!(rule.fg in colors) || !(bg in colors)) throw new Error(`Token inconnu dans contrast : ${rule.fg} / ${bg}`);
          const ratio = contrastRatio(colors[rule.fg], colors[bg]);
          results.push({ charte: charte.id, theme: theme.id, fg: rule.fg, bg, ratio, min: rule.min, ok: ratio >= rule.min });
        }
      }
    }
  }
  return results;
}
