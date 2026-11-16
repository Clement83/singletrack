import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #1389 : Tailwind 4 ne met plus `cursor: pointer` sur les boutons ; le socle le rétablit.
const css = readFileSync('src/app/globals.css', 'utf8');

describe('socle CSS des interactions', () => {
  it('curseur main sur les éléments cliquables', () => {
    expect(css).toMatch(/button:not\(:disabled\)[\s\S]*?cursor:\s*pointer/);
    expect(css).toMatch(/\[role='button'\][\s\S]*?cursor:\s*pointer/);
  });
  it('curseur interdit sur les éléments désactivés', () => {
    expect(css).toMatch(/:disabled,\s*\[aria-disabled='true'\]\s*\{\s*cursor:\s*not-allowed/);
  });
  it('pas de délai de double-tap sur les éléments interactifs', () => {
    expect(css).toMatch(/touch-action:\s*manipulation/);
  });
});
