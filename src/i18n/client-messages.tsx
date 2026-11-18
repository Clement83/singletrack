import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { Messages } from './messages';

/**
 * Messages transmis au navigateur, par zone du site (#1405) : `NextIntlClientProvider` sans `messages` explicites
 * enverrait **tout** le catalogue dans chaque page. Les composants serveur, eux, lisent le catalogue complet
 * (`getTranslations`) sans rien envoyer.
 *
 * Un provider imbriqué **remplace** les messages du parent (pas de fusion) : chaque zone liste donc tout ce
 * dont ses composants client ont besoin. `tests/i18n-client.test.ts` le vérifie par analyse des imports.
 */
type Ns = keyof Messages;
const ROOT: Ns[] = ['common', 'errors'];
const TRACK: Ns[] = ['profile', 'map', 'track', 'scales', 'trackDelete', 'trackVisibility'];

export const CLIENT_NAMESPACES = {
  root: ROOT,
  auth: [...ROOT, 'auth', 'welcome'],
  track: [...ROOT, ...TRACK, 'userMenu'],
  guest: [...ROOT, ...TRACK, 'rsvp', 'share', 'conditions', 'comments', 'ride', 'photos', 'claim', 'inviteFriends', 'userMenu', 'participants', 'outingView', 'nextStep', 'outingBar', 'sheet'],
  outing: [...ROOT, ...TRACK, 'rsvp', 'join', 'share', 'outingManager', 'inviteFriends', 'contacts', 'outingForm', 'outingVisibility', 'duplicate', 'outingLabels', 'conditions', 'comments', 'ride', 'photos', 'userMenu', 'participants', 'outingView', 'nextStep', 'outingBar', 'sheet'],
  editor: [...ROOT, ...TRACK, 'editor', 'singles', 'userMenu', 'userProfile', 'outingVisibility'],
  private: [
    ...ROOT, ...TRACK, 'nav', 'sheet', 'theme', 'charte', 'share', 'userMenu', 'explorer', 'filters', 'trackCard', 'singles', 'importer', 'editor', 'contacts', 'friends', 'history', 'userProfile',
    'outingForm', 'outingVisibility', 'outingLabels', 'conditions', 'outings', 'outingsMap', 'remoteOutings', 'moderation', 'guest', 'participants', 'outingView',
  ],
  all: 'all',
} satisfies Record<string, Ns[] | 'all'>;

export type ClientZone = keyof typeof CLIENT_NAMESPACES;

export async function clientMessages(zone: ClientZone) {
  const all = (await getMessages()) as Messages;
  const ns = CLIENT_NAMESPACES[zone];
  if (ns === 'all') return all;
  return Object.fromEntries(ns.map((k) => [k, all[k]])) as Partial<Messages>;
}

/** Provider de la zone : à poser dans le layout du segment. */
export async function ClientMessages({ zone, children }: { zone: ClientZone; children: React.ReactNode }) {
  return <NextIntlClientProvider messages={await clientMessages(zone)}>{children}</NextIntlClientProvider>;
}
