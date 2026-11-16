import type { Locale } from './config';
import type { Messages } from './messages';

// Clés de traduction typées : une clé absente de messages/fr.json est une erreur de compilation.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
