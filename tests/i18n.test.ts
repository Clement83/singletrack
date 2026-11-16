import { describe, it, expect } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import fr from '../messages/fr.json';
import en from '../messages/en.json';
import { DEFAULT_LOCALE, LOCALES, isLocale, parseAcceptLanguage, resolveLocale } from '../src/i18n/config';
import { translatorFor } from '../src/i18n/server';

type Tree = { [k: string]: string | Tree };
const leaves = (t: Tree, prefix = ''): [string, string][] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));

describe('i18n : choix de la langue', () => {
  it('fr et en, français par défaut', () => {
    expect(LOCALES).toEqual(['fr', 'en']);
    expect(DEFAULT_LOCALE).toBe('fr');
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });
  it('lit Accept-Language par préférence (q) et réduit à la langue', () => {
    expect(parseAcceptLanguage('de-DE,de;q=0.9,en-US;q=0.8,fr;q=0.7')).toEqual(['de', 'de', 'en', 'fr']);
    expect(parseAcceptLanguage('fr;q=0.5, en')).toEqual(['en', 'fr']);
    expect(parseAcceptLanguage('*;q=0.1, en;q=0')).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });
  it('cookie > navigateur > français', () => {
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'fr-FR' })).toBe('en');
    expect(resolveLocale({ cookie: 'xx', acceptLanguage: 'de,en;q=0.8' })).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'de,es' })).toBe('fr');
    expect(resolveLocale({})).toBe('fr');
  });
});

describe('i18n : catalogues', () => {
  const frLeaves = leaves(fr as Tree);
  const enLeaves = leaves(en as Tree);
  it('en.json a exactement les mêmes clés que fr.json (référence)', () => {
    expect(enLeaves.map(([k]) => k).sort()).toEqual(frLeaves.map(([k]) => k).sort());
  });
  it('aucun texte vide', () => {
    expect([...frLeaves, ...enLeaves].filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });
  it('chaque message est un ICU valide, avec les mêmes variables en fr et en en', () => {
    const vars = (m: string) => [...m.matchAll(/\{(\w+)/g)].map((x) => x[1]).sort();
    const enMap = new Map(enLeaves);
    for (const [k, v] of frLeaves) {
      expect(() => new IntlMessageFormat(v, 'fr'), k).not.toThrow();
      expect(() => new IntlMessageFormat(enMap.get(k)!, 'en'), k).not.toThrow();
      expect(vars(enMap.get(k)!), k).toEqual(vars(v));
    }
  });
  it('pas de « ... » ni d’apostrophe droite dans les textes affichés', () => {
    const bad = [...frLeaves, ...enLeaves].filter(([, v]) => v.includes('...') || /\w'\w/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });
  it('ponctuation : espace insécable avant « : ; ! ? » et dans les guillemets en français, jamais en anglais (#1390)', () => {
    const frBad = frLeaves.filter(([, v]) => / [:;!?»]|« /.test(v)).map(([k]) => k);
    expect(frBad).toEqual([]);
    const enBad = enLeaves.filter(([, v]) => /[\u00a0\u202f][:;!?]/.test(v)).map(([k]) => k);
    expect(enBad).toEqual([]);
  });
});

describe('i18n : traducteur hors requête (mails)', () => {
  it('traduit dans la langue demandée, français si inconnue', () => {
    expect(translatorFor('en')('auth.signIn')).toBe('Sign in');
    expect(translatorFor('fr')('auth.signIn')).toBe('Me connecter');
    expect(translatorFor(null)('auth.signIn')).toBe('Me connecter');
    expect(translatorFor('de')('auth.signIn')).toBe('Me connecter');
  });
});
