import tokens from '../../../design/tokens.json';

/** Thèmes déclarés dans design/tokens.json : en ajouter un là-bas suffit à le proposer ici. */
export const THEMES: { id: string; name: string }[] = tokens.themes.map(({ id, name }) => ({ id, name }));

/** Chartes graphiques déclarées dans design/tokens.json (#1624), indépendantes du clair/sombre. */
export const CHARTES: { id: string; name: string }[] = tokens.chartes.map(({ id, name }) => ({ id, name }));
