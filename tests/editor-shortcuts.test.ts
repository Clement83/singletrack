import { describe, it, expect } from 'vitest';
import { isTypingTarget, shortcutFor, SHORTCUTS, ariaShortcut } from '../src/lib/editor/shortcuts';

const el = (o: object) => o as unknown as EventTarget;

describe('raccourcis de l’éditeur desktop (#1393)', () => {
  it('annuler / rétablir avec Ctrl ou Cmd', () => {
    expect(shortcutFor({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(shortcutFor({ key: 'z', metaKey: true })).toBe('undo');
    expect(shortcutFor({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(shortcutFor({ key: 'y', ctrlKey: true })).toBe('redo');
  });
  it('touches simples : mode, suppression, aide, échap, enregistrer', () => {
    expect(shortcutFor({ key: 'r' })).toBe('modeRoute');
    expect(shortcutFor({ key: 'R' })).toBe('modeRoute'); // verrouillage majuscules
    expect(shortcutFor({ key: 'R', shiftKey: true })).toBe('snapAll');
    expect(shortcutFor({ key: 'm' })).toBe('toggleMode');
    expect(shortcutFor({ key: 'i' })).toBe('reverse');
    expect(shortcutFor({ key: 'b' })).toBe('close');
    expect(shortcutFor({ key: 'b' }, true)).toBeNull();
    expect(shortcutFor({ key: 'd' })).toBe('modeLine');
    expect(shortcutFor({ key: 'Delete' })).toBe('delete');
    expect(shortcutFor({ key: 'Backspace' })).toBe('delete');
    expect(shortcutFor({ key: '?', shiftKey: true })).toBe('help');
    expect(shortcutFor({ key: 'Escape' })).toBe('escape');
    expect(shortcutFor({ key: 's', ctrlKey: true })).toBe('save');
  });
  it('rien pour les autres touches ou combinaisons', () => {
    expect(shortcutFor({ key: 'x' })).toBeNull();
    expect(shortcutFor({ key: 'r', ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: 'r', altKey: true })).toBeNull();
    expect(shortcutFor({ key: 'z', ctrlKey: true, altKey: true })).toBeNull();
  });
  it('dans un champ : seuls Échap et Mod+S restent actifs', () => {
    expect(shortcutFor({ key: 'r' }, true)).toBeNull();
    expect(shortcutFor({ key: 'Backspace' }, true)).toBeNull();
    expect(shortcutFor({ key: 'z', ctrlKey: true }, true)).toBeNull();
    expect(shortcutFor({ key: 'Escape' }, true)).toBe('escape');
    expect(shortcutFor({ key: 's', metaKey: true }, true)).toBe('save');
  });
  it('isTypingTarget reconnaît les champs de saisie', () => {
    expect(isTypingTarget(el({ tagName: 'INPUT', type: 'text' }))).toBe(true);
    expect(isTypingTarget(el({ tagName: 'INPUT', type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(el({ tagName: 'TEXTAREA' }))).toBe(true);
    expect(isTypingTarget(el({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(el({ tagName: 'BUTTON' }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
  it('chaque action a sa valeur aria-keyshortcuts', () => {
    for (const s of SHORTCUTS) expect(ariaShortcut(s.action)).toBeTruthy();
  });
});
