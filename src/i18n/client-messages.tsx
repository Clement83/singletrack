import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { Messages } from './messages';

/**
 * Messages passed to the browser, per area of the site (#1405): `NextIntlClientProvider` without explicit `messages`
 * would send the **whole** catalogue in every page. Server components read the full catalogue
 * (`getTranslations`) without sending anything.
 *
 * A nested provider **replaces** the parent's messages (no merge): each area therefore lists everything
 * its client components need. `tests/i18n-client.test.ts` checks it by analysing the imports.
 */
type Ns = keyof Messages;
const ROOT: Ns[] = ['common', 'errors'];
const TRACK: Ns[] = ['profile', 'map', 'track', 'scales', 'trackDelete', 'trackVisibility'];

export const CLIENT_NAMESPACES = {
  root: ROOT,
  auth: [...ROOT, 'auth', 'welcome'],
  track: [...ROOT, ...TRACK, 'userMenu'],
  guest: [...ROOT, ...TRACK, 'rsvp', 'share', 'conditions', 'comments', 'ride', 'photos', 'summary', 'moments', 'claim', 'inviteFriends', 'userMenu', 'participants', 'outingView', 'nextStep', 'outingBar', 'sheet'],
  outing: [...ROOT, ...TRACK, 'rsvp', 'join', 'share', 'outingManager', 'inviteFriends', 'contacts', 'outingForm', 'outingVisibility', 'duplicate', 'outingLabels', 'conditions', 'comments', 'ride', 'photos', 'summary', 'moments', 'userMenu', 'participants', 'outingView', 'nextStep', 'outingBar', 'sheet'],
  editor: [...ROOT, ...TRACK, 'editor', 'singles', 'userMenu', 'userProfile', 'outingVisibility'],
  private: [
    ...ROOT, ...TRACK, 'nav', 'sheet', 'theme', 'charte', 'share', 'userMenu', 'explorer', 'filters', 'trackCard', 'singles', 'importer', 'editor', 'contacts', 'friends', 'history', 'userProfile',
    'outingForm', 'outingVisibility', 'outingLabels', 'conditions', 'outings', 'outingsMap', 'remoteOutings', 'moderation', 'admin', 'guest', 'participants', 'outingView', 'summary', 'moments', 'ride', 'photos',
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

/** Provider of the area: to place in the segment's layout. */
export async function ClientMessages({ zone, children }: { zone: ClientZone; children: React.ReactNode }) {
  return <NextIntlClientProvider messages={await clientMessages(zone)}>{children}</NextIntlClientProvider>;
}
