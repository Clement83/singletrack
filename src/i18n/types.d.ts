import type { Locale } from './config';
import type { Messages } from './messages';

// Typed translation keys: a key missing from messages/fr.json is a compilation error.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
