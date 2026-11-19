import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Design-system drift rule (#1363): no hard-coded colour in the code.
// Colours come from design/tokens.json → src/app/styles/tokens.css (CSS variables).
const COLOR_MSG =
  'Couleur en dur interdite : utiliser un token (classe Tailwind bg-primary, text-muted-foreground… ou var(--token)). Voir design/README.md.';
const HEX = '/#[0-9a-fA-F]{3,8}\\b/';
const FN = '/\\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\\(/';
const UTIL = '(bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|shadow|placeholder)';
const TW_ARBITRARY = `/${UTIL}-\\[(#|rgb|hsl|oklch|color)/`;
const TW_PALETTE = `/(^|[\\s:])${UTIL}-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)\\b/`;
const noHardcodedColors = [HEX, FN, TW_ARBITRARY, TW_PALETTE].flatMap((re) => [
  { selector: `Literal[value=${re}]`, message: COLOR_MSG },
  { selector: `TemplateElement[value.raw=${re}]`, message: COLOR_MSG },
]);

// Multilingual (#1398, enabled by #1402): no hard-coded UI text in JSX, everything goes through
// messages/fr.json and messages/en.json. The styleguide (internal reference, sample content) is excluded.
const TEXT_MSG = 'Texte en dur interdit : ajouter une clé dans messages/fr.json et messages/en.json (voir AGENTS.md, « Multilingue »).';
const LETTERS = '/[A-Za-zÀ-ÿ]{2,}/';
const noHardcodedText = [
  { selector: `JSXText[value=${LETTERS}]`, message: TEXT_MSG },
  { selector: `JSXAttribute[name.name=/^(aria-label|placeholder|title|label|hint|alt|description)$/] > Literal[value=${LETTERS}]`, message: TEXT_MSG },
];

// No system alert (#1448): confirmations go through ConfirmDialog (src/components/ui/confirm-dialog.tsx).
// Only exception: `beforeunload` (the browser enforces its own text, no app API).
const DIALOG_MSG = 'Dialogue système interdit : utiliser ConfirmDialog (src/components/ui/confirm-dialog.tsx) ou un toast.';
const noSystemDialogs = ['alert', 'confirm', 'prompt'].flatMap((n) => [
  { selector: `CallExpression[callee.name='${n}']`, message: DIALOG_MSG },
  { selector: `CallExpression[callee.object.name=/^(window|globalThis|self)$/][callee.property.name='${n}']`, message: DIALOG_MSG },
]);

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', 'coverage/**', 'node_modules/**', 'data/**', '.claude/worktrees/**', '.verif/**', 'next-env.d.ts', 'src/db/migrations/**', 'spikes/**', 'e2e/**', '.next-build/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...noHardcodedColors, ...noSystemDialogs] },
  },
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/app/(private)/styleguide/**'],
    rules: { 'no-restricted-syntax': ['error', ...noHardcodedColors, ...noHardcodedText, ...noSystemDialogs] },
  },
];
export default config;
