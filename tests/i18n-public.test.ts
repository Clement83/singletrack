import { describe, expect, it } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { mailLocale } from '@/lib/auth';
import { signInCodeMail } from '@/lib/mail-templates';
import { fireMessage, fireTone, type FireInfo } from '@/lib/fire';
import { translatorFor } from '@/i18n/server';

// Passe de traduction des pages publiques et des mails (#1401).
describe('mail de connexion dans la langue du destinataire', () => {
  it('anglais : objet, texte, HTML et pièce jointe', async () => {
    const m = await signInCodeMail('a@b.fr', '123456', 'https://x/login/lien#e=a&c=1', 10, 'en');
    expect(m.subject).toBe('123456 — your Singletrack code');
    expect(m.html).toContain('<html lang="en">');
    expect(m.html).toContain('Sign me in');
    expect(m.text).toContain('valid for 10 minutes');
    expect(m.attachments?.[0].filename).toBe('sign-in.png');
  });
  it('langue inconnue → français', async () => {
    const m = await signInCodeMail('a@b.fr', '123456', 'https://x', 10, 'de');
    expect(m.subject).toBe('123456 — ton code Singletrack');
    expect(m.html).toContain('<html lang="fr">');
  });
  it('langue du compte, sinon cookie, sinon navigateur, sinon français', () => {
    const { db } = openDb(':memory:');
    const now = new Date();
    db.insert(user).values({ id: 'u1', name: 'A', email: 'en@x.fr', emailVerified: true, locale: 'en', createdAt: now, updatedAt: now }).run();
    expect(mailLocale(db, 'EN@x.fr')).toBe('en');
    expect(mailLocale(db, 'new@x.fr', new Headers({ cookie: 'a=1; NEXT_LOCALE=en' }))).toBe('en');
    expect(mailLocale(db, 'new@x.fr', new Headers({ 'accept-language': 'en-US,en;q=0.9' }))).toBe('en');
    expect(mailLocale(db, 'new@x.fr')).toBe('fr');
  });
});

describe('messages incendie traduits', () => {
  const closed: FireInfo = { kind: 'ok', date: '2026-08-01', worst: 5, names: ['Maures', 'Siagne'], massifs: [{ code: '1', name: 'Maures', level: 5 }, { code: '2', name: 'Siagne', level: 4 }] } as FireInfo;
  const tr = (l: string) => (k: string, v?: Record<string, unknown>) => translatorFor(l)(`fire.${k}` as never, v as never);
  it('français et anglais, listes selon la langue', () => {
    expect(fireMessage(closed, tr('fr'), 'fr').banner).toBe('Accès interdit — massifs Maures et Siagne, risque exceptionnel');
    const en = fireMessage(closed, tr('en'), 'en');
    expect(en.banner).toBe('Access forbidden — Maures and Siagne forests, exceptional risk');
    expect(en.tone).toBe('danger');
  });
  it('ton seul, sans texte', () => {
    expect(fireTone(closed)).toBe('danger');
    expect(fireTone({ kind: 'none', date: 'x', names: [] } as FireInfo)).toBe('ok');
    expect(fireTone({ kind: 'off_season', date: 'x', names: [] } as FireInfo)).toBe('muted');
  });
});
