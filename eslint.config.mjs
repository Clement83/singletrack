import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Règle anti-dérive du design system (#1363) : aucune couleur en dur dans le code.
// Les couleurs viennent de design/tokens.json → src/app/styles/tokens.css (variables CSS).
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

// Multilingue (#1398, activé par #1402) : aucun texte d'interface en dur dans le JSX, tout passe par
// messages/fr.json et messages/en.json. Le styleguide (référence interne, contenus d'exemple) est exclu.
const TEXT_MSG = 'Texte en dur interdit : ajouter une clé dans messages/fr.json et messages/en.json (voir AGENTS.md, « Multilingue »).';
const LETTERS = '/[A-Za-zÀ-ÿ]{2,}/';
const noHardcodedText = [
  { selector: `JSXText[value=${LETTERS}]`, message: TEXT_MSG },
  { selector: `JSXAttribute[name.name=/^(aria-label|placeholder|title|label|hint|alt|description)$/] > Literal[value=${LETTERS}]`, message: TEXT_MSG },
];

// Pas d'alerte système (#1448) : confirmations par ConfirmDialog (src/components/ui/confirm-dialog.tsx).
// Seule exception : `beforeunload` (le navigateur impose son propre texte, aucune API d'app).
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
