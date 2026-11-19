import tokens from '../../../design/tokens.json';

/** Themes declared in design/tokens.json: adding one there is enough to offer it here. */
export const THEMES: { id: string; name: string }[] = tokens.themes.map(({ id, name }) => ({ id, name }));

/** Visual charters declared in design/tokens.json (#1624), independent of light/dark. */
export const CHARTES: { id: string; name: string }[] = tokens.chartes.map(({ id, name }) => ({ id, name }));
