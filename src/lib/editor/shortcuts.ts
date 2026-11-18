// Raccourcis clavier de l'éditeur desktop (#1393, complétés en #1384 : M, I, B, Maj+R). Logique pure, testée dans tests/editor-shortcuts.test.ts.

export type ShortcutAction =
  | 'undo' | 'redo' | 'delete' | 'escape' | 'modeRoute' | 'modeLine' | 'toggleMode' | 'reverse' | 'close' | 'snapAll' | 'altRoute' | 'keepChoice' | 'save' | 'help';

export type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

/**
 * Liste affichée dans l'aide « ? » et dans les info-bulles (`keys` = touches à afficher, traduites via
 * `editor.keys.*` quand ce sont des noms ; `aria` = valeur de `aria-keyshortcuts`). `mod` = Ctrl (Cmd sur Mac).
 */
export const SHORTCUTS: { action: ShortcutAction; keys: string[]; aria: string }[] = [
  { action: 'modeRoute', keys: ['R'], aria: 'R' },
  { action: 'modeLine', keys: ['D'], aria: 'D' },
  { action: 'toggleMode', keys: ['M'], aria: 'M' },
  { action: 'snapAll', keys: ['shift', 'R'], aria: 'Shift+R' },
  { action: 'altRoute', keys: ['A'], aria: 'A' },
  { action: 'keepChoice', keys: ['enter'], aria: 'Enter' },
  { action: 'reverse', keys: ['I'], aria: 'I' },
  { action: 'close', keys: ['B'], aria: 'B' },
  { action: 'undo', keys: ['mod', 'Z'], aria: 'Control+Z Meta+Z' },
  { action: 'redo', keys: ['mod', 'shift', 'Z'], aria: 'Control+Shift+Z Meta+Shift+Z Control+Y' },
  { action: 'delete', keys: ['delete'], aria: 'Delete Backspace' },
  { action: 'escape', keys: ['escape'], aria: 'Escape' },
  { action: 'save', keys: ['mod', 'S'], aria: 'Control+S Meta+S' },
  { action: 'help', keys: ['?'], aria: 'Shift+?' },
];

export const ariaShortcut = (a: ShortcutAction) => SHORTCUTS.find((s) => s.action === a)?.aria;

/** Vrai si le focus est dans un champ de saisie : les raccourcis à une touche ne doivent pas s'y déclencher. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false;
  const e = el as { tagName: string; isContentEditable?: boolean; type?: string };
  const tag = e.tagName.toLowerCase();
  if (e.isContentEditable) return true;
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range'].includes((e.type ?? 'text').toLowerCase());
  return false;
}

/**
 * Action correspondant à une touche, ou `null`. `typing` = focus dans un champ : seuls Échap et Mod+S restent
 * actifs (on peut enregistrer depuis le champ « nom ») ; annuler/rétablir reviennent au champ.
 */
export function shortcutFor(e: KeyLike, typing = false): ShortcutAction | null {
  const mod = !!(e.ctrlKey || e.metaKey);
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'Escape') return 'escape';
  if (mod && !e.altKey && key === 's') return 'save';
  if (typing) return null;
  if (mod && !e.altKey) {
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !e.shiftKey) return 'redo';
    return null;
  }
  if (mod || e.altKey) return null;
  if (key === 'Enter') return 'keepChoice';
  if (key === 'Delete' || key === 'Backspace') return 'delete';
  if (key === '?') return 'help';
  if (key === 'r') return e.shiftKey ? 'snapAll' : 'modeRoute';
  if (key === 'm') return 'toggleMode';
  if (key === 'a') return 'altRoute';
  if (key === 'i') return 'reverse';
  if (key === 'b') return 'close';
  if (key === 'd') return 'modeLine';
  return null;
}
