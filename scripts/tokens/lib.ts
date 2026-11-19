// singletrack design system (#1363): reads design/tokens.json, generates
// src/app/styles/tokens.css and checks the WCAG contrasts. Pure functions, tested
// in tests/tokens.test.ts.

export type Theme = { id: string; name: string; scheme: 'light' | 'dark'; extends?: string; usage?: string };
type Named = { name: string; usage: string };
/** Value of a token: a string (every theme) or a value per theme / scheme (`light`, `dark`). */
export type Value = string | Record<string, string>;
/** Visual charter (#1624): axis independent of light/dark. `extends`: inherits from another charter (default: the first one). */
export type Charte = { id: string; name: string; extends?: string; usage?: string };
/** Per-charter overrides: `{ "<charter>": <value> }`; absent = inherited (Classique as a last resort). */
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
  /** Animation curves (#1645): `--ease-<name>` in @theme (classes `ease-out`, `ease-spring`…). */
  easing?: ValueToken[];
  map: ValueToken[];
};

export const GENERATED_HEADER =
  '/* FICHIER GÉNÉRÉ par `npm run tokens` depuis design/tokens.json : ne pas éditer à la main. */';

/** Value of a token for a theme, following `extends` (e.g. a trial theme → light) then the scheme (dark → dark). */
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

/** Inheritance chain of a charter: itself, its parents, then the base charter (Classique). */
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

/** Effective value of a token for a charter × a theme: closest charter override, otherwise the base value. */
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

/** Every CSS variable that depends on the charter and/or the theme, for a given pair. */
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

/** Theme variables of a charter, except those declared elsewhere (static @theme) for the base charter. */
const THEME_VAR = /^--(?!font-|radius-|text-)/;

function themeBlock(tokens: Tokens, theme: Theme): string[] {
  const vars = charteThemeVars(tokens, tokens.chartes[0].id, theme.id);
  return [`  color-scheme: ${theme.scheme};`, ...Object.entries(vars).filter(([k]) => THEME_VAR.test(k)).map(([k, x]) => `  ${k}: ${x};`)];
}

/** Blocks of a non-base charter: per theme, only the variables that differ from the base charter. */
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

/** Full stylesheet: variables per theme + Tailwind 4 wiring (@theme). */
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

  // Tailwind wiring: only our tokens (default Tailwind palette disabled).
  out.push('@theme inline {', '  --color-*: initial;');
  for (const c of tokens.color) out.push(`  --color-${c.name}: var(--${c.name});`);
  out.push('  --shadow-*: initial;');
  for (const s of tokens.shadow) out.push(`  --shadow-${s.name}: var(--elevation-${s.name});`);
  out.push('}', '');

  // static: every variable is emitted, even unused ones (read by /styleguide and MapLibre).
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
  for (const e of tokens.easing ?? []) out.push(`  --ease-${e.name}: ${e.value};`);
  out.push('  --default-transition-duration: var(--duration-fast);');
  if (tokens.easing?.some((e) => e.name === 'out')) out.push('  --default-transition-timing-function: var(--ease-out);');
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
