import fr from '../../messages/fr.json';
import en from '../../messages/en.json';
import type { Locale } from './config';

/** Catalogues de traduction. Le français est la référence : `en.json` doit avoir exactement les mêmes clés (test). */
export const MESSAGES: Record<Locale, typeof fr> = { fr, en };
export type Messages = typeof fr;
