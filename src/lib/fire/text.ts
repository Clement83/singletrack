import type { FireInfo } from './conditions';
import { accessOf } from './levels';

export type FireTone = 'danger' | 'warn' | 'ok' | 'muted';

export type FireMessage = {
  tone: FireTone;
  /** Short sentence ("Fire" line of the Conditions block). */
  short: string;
  /** Prominent banner (access forbidden or not advised), otherwise absent. */
  banner?: string;
  /** Detail under the line. */
  note?: string;
};

/** Translator of the `fire` namespace (`getTranslations('fire')`, `useTranslations('fire')`, `translatorFor`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FireT = (key: any, values?: any) => string;

const list = (names: string[], locale: string) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);

/** Tone only (verdict), no text: outing organisation screen (#1407). */
export function fireTone(info: FireInfo): FireTone {
  if (info.kind === 'ok') {
    if (info.massifs.some((m) => accessOf(m.level) === 'forbidden')) return 'danger';
    if (info.massifs.some((m) => accessOf(m.level) === 'warn')) return 'warn';
    return 'ok';
  }
  return info.kind === 'none' ? 'ok' : 'muted';
}

/** Text to show for a track/outing on a date, in the translator's language (#1401), simple tone of the charter. */
export function fireMessage(info: FireInfo, t: FireT, locale = 'fr'): FireMessage {
  const massifs = (names: string[]) => t(names.length > 1 ? 'massifMany' : 'massifOne', { names: list(names, locale) });
  switch (info.kind) {
    case 'ok': {
      const forbidden = info.massifs.filter((m) => accessOf(m.level) === 'forbidden');
      if (forbidden.length) {
        const k = forbidden.some((m) => m.level === 5) ? 'closed' : 'forbidden';
        return { tone: 'danger', short: t(`short.${k}`), banner: t(`banner.${k}`, { massifs: massifs(forbidden.map((m) => m.name)) }), note: t(`note.${k}`) };
      }
      const warn = info.massifs.filter((m) => accessOf(m.level) === 'warn');
      if (warn.length) {
        return { tone: 'warn', short: t('short.warn'), banner: t('banner.warn', { massifs: massifs(warn.map((m) => m.name)) }), note: t('note.warn') };
      }
      return { tone: 'ok', short: t(info.worst === 2 ? 'short.okCareful' : 'short.ok'), note: t('note.crosses', { names: list(info.names, locale) }) };
    }
    case 'none':
      return { tone: 'ok', short: t('short.none'), note: t('note.none') };
    case 'off_season':
      return { tone: 'muted', short: t('short.offSeason'), note: t('note.offSeason') };
    case 'pending':
      return { tone: 'muted', short: t('short.pending'), note: t('note.pending') };
    case 'unavailable':
      return { tone: 'muted', short: t('short.unavailable'), note: t('note.unavailable') };
    default:
      return { tone: 'muted', short: t('short.unknown') };
  }
}

/** True if the closed level (red/black) concerns the track that day. */
export const isFireBlocked = (i: FireInfo) => i.kind === 'ok' && i.massifs.some((m) => accessOf(m.level) === 'forbidden');
