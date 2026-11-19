import fr from '../../messages/fr.json';
import en from '../../messages/en.json';
import type { Locale } from './config';

/** Translation catalogues. French is the reference: `en.json` must have exactly the same keys (test). */
export const MESSAGES: Record<Locale, typeof fr> = { fr, en };
export type Messages = typeof fr;
