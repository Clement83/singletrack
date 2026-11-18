// `npm run tokens` : génère src/app/styles/tokens.css depuis design/tokens.json (#1363).
// `npm run tokens -- --report` : affiche tous les contrastes.
// `npm run tokens -- --check` : échoue si le fichier généré n'est pas à jour ou si un contraste échoue.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkContrasts, generateCss, type Tokens } from './lib';

const root = path.resolve(__dirname, '../..');
const TOKENS_JSON = path.join(root, 'design/tokens.json');
const TOKENS_CSS = path.join(root, 'src/app/styles/tokens.css');

const tokens = JSON.parse(readFileSync(TOKENS_JSON, 'utf8')) as Tokens;
const css = generateCss(tokens);

const results = checkContrasts(tokens);
if (process.argv.includes('--report')) {
  for (const r of results) {
    console.log(`${r.ok ? ' ' : '✗'} ${r.charte.padEnd(10)} ${r.theme.padEnd(6)} ${r.fg.padEnd(22)} ${r.bg.padEnd(17)} ${r.ratio.toFixed(2)} / ${r.min}`);
  }
}
const failures = results.filter((r) => !r.ok);
for (const f of failures) {
  console.error(`✗ contraste ${f.charte}/${f.theme} : ${f.fg} sur ${f.bg} = ${f.ratio.toFixed(2)} (min ${f.min})`);
}

if (process.argv.includes('--check')) {
  const current = readFileSync(TOKENS_CSS, 'utf8');
  if (current !== css) {
    console.error('✗ src/app/styles/tokens.css n’est pas à jour : lancer `npm run tokens`.');
    process.exit(1);
  }
  console.log('✓ tokens.css à jour');
} else {
  writeFileSync(TOKENS_CSS, css);
  console.log(`✓ ${path.relative(root, TOKENS_CSS)} généré (${tokens.chartes.map((c) => c.id).join(', ')} × ${tokens.themes.map((t) => t.id).join(', ')})`);
}
if (failures.length) process.exit(1);
