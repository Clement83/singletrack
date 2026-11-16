import type { FireInfo } from './conditions';
import { accessOf } from './levels';

export type FireTone = 'danger' | 'warn' | 'ok' | 'muted';

export type FireMessage = {
  tone: FireTone;
  /** Phrase courte (ligne « Incendie » du bloc Conditions). */
  short: string;
  /** Bannière bien visible (accès interdit ou déconseillé), sinon absente. */
  banner?: string;
  /** Précision sous la ligne. */
  note?: string;
};

/** Traducteur du namespace `fire` (`getTranslations('fire')`, `useTranslations('fire')`, `translatorFor`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FireT = (key: any, values?: any) => string;

const list = (names: string[], locale: string) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);

/** Ton seul (verdict), sans texte : écran d'organisation d'une sortie (#1407). */
export function fireTone(info: FireInfo): FireTone {
  if (info.kind === 'ok') {
    if (info.massifs.some((m) => accessOf(m.level) === 'forbidden')) return 'danger';
    if (info.massifs.some((m) => accessOf(m.level) === 'warn')) return 'warn';
    return 'ok';
  }
  return info.kind === 'none' ? 'ok' : 'muted';
}

/** Texte à afficher pour une trace/sortie à une date, dans la langue du traducteur (#1401), ton simple de la charte. */
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

/** Vrai si le niveau fermé (rouge/noir) concerne la trace ce jour-là. */
export const isFireBlocked = (i: FireInfo) => i.kind === 'ok' && i.massifs.some((m) => accessOf(m.level) === 'forbidden');
