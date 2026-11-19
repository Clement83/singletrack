import QRCode from 'qrcode';
import tokens from '../../design/tokens.json';
import type { MailMessage } from './mail';
import { translatorFor } from '@/i18n/server';
import { isLocale, DEFAULT_LOCALE } from '@/i18n/config';

// Couleurs lues dans la source unique des tokens (thème clair : les clients mail gèrent mal le sombre).
const c = (name: string) => tokens.color.find((t) => t.name === name)!.value.light;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Lien de connexion : email et code dans le fragment (#), jamais envoyé au serveur ni écrit dans les logs nginx. */
export function signInLink(baseUrl: string, email: string, otp: string, next?: string) {
  // `next` (page d'origine, #1595) : déjà validé par `safeNext`, relu et revalidé côté client.
  return `${baseUrl.replace(/\/$/, '')}/login/lien#${new URLSearchParams({ e: email, c: otp, ...(next ? { n: next } : {}) })}`;
}

/**
 * Mail de connexion (#1377) : code à 6 chiffres, bouton, et QR code (mail lu sur PC, connexion sur le téléphone).
 * Dans la langue du destinataire (#1401) : celle de son compte, sinon celle de la page qui a demandé le code.
 */
export async function signInCodeMail(to: string, otp: string, url: string, minutes: number, locale?: string | null): Promise<MailMessage> {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const t = translatorFor(lang);
  const qr = await QRCode.toBuffer(url, {
    type: 'png',
    width: 360,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: c('foreground'), light: c('card') },
  });
  const href = esc(url);
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:${c('background')};font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:${c('foreground')}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${c('card')};border-radius:12px;padding:28px 24px;border:1px solid ${c('border')}">
<tr><td style="font-size:22px;font-weight:650;letter-spacing:-0.4px;padding-bottom:16px">Singletrack</td></tr>
<tr><td style="font-size:16px;line-height:1.5;padding-bottom:16px">${esc(t('mail.signIn.intro'))}</td></tr>
<tr><td align="center" style="font-size:36px;font-weight:700;letter-spacing:8px;padding:8px 0 24px;font-variant-numeric:tabular-nums">${esc(otp)}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${href}" style="display:block;text-align:center;background:${c('primary')};color:${c('primary-foreground')};text-decoration:none;font-weight:560;font-size:16px;padding:14px 20px;border-radius:8px">${esc(t('mail.signIn.button'))}</a></td></tr>
<tr><td align="center" style="font-size:14px;line-height:1.5;color:${c('muted-foreground')};padding-bottom:8px">${esc(t('mail.signIn.qrHint'))}</td></tr>
<tr><td align="center" style="padding-bottom:24px"><img src="cid:qr" width="180" height="180" alt="${esc(t('mail.signIn.qrAlt'))}" style="display:block;border-radius:8px"></td></tr>
<tr><td style="font-size:14px;line-height:1.5;color:${c('muted-foreground')}">${esc(t('mail.signIn.validity', { minutes }))}</td></tr>
</table></td></tr></table></body></html>`;
  return {
    to,
    subject: t('mail.signIn.subject', { otp }),
    html,
    text: t('mail.signIn.text', { otp, url, minutes }),
    attachments: [{ filename: t('mail.signIn.qrFile'), content: qr.toString('base64'), contentId: 'qr' }],
  };
}

/** Mail « un copain t'invite à une sortie » (#1458) : sobre, un bouton vers le lien personnel. Langue = compte du destinataire. */
export function friendInviteMail(
  to: string, d: { inviter: string; title: string; date: string; url: string }, locale?: string | null,
): MailMessage {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const t = translatorFor(lang);
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:${c('background')};font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:${c('foreground')}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${c('card')};border-radius:12px;padding:28px 24px;border:1px solid ${c('border')}">
<tr><td style="font-size:22px;font-weight:650;letter-spacing:-0.4px;padding-bottom:16px">Singletrack</td></tr>
<tr><td style="font-size:16px;line-height:1.5;padding-bottom:8px">${esc(t('mail.friendInvite.intro', { inviter: d.inviter }))}</td></tr>
<tr><td style="font-size:20px;font-weight:700;padding-bottom:4px">${esc(d.title)}</td></tr>
<tr><td style="font-size:16px;color:${c('muted-foreground')};padding-bottom:24px">${esc(d.date)}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${esc(d.url)}" style="display:block;text-align:center;background:${c('primary')};color:${c('primary-foreground')};text-decoration:none;font-weight:560;font-size:16px;padding:14px 20px;border-radius:8px">${esc(t('mail.friendInvite.button'))}</a></td></tr>
<tr><td style="font-size:14px;line-height:1.5;color:${c('muted-foreground')}">${esc(t('mail.friendInvite.hint'))}</td></tr>
</table></td></tr></table></body></html>`;
  return {
    to,
    subject: t('mail.friendInvite.subject', { inviter: d.inviter, title: d.title }),
    html,
    text: t('mail.friendInvite.text', { inviter: d.inviter, title: d.title, date: d.date, url: d.url }),
  };
}

/**
 * Mail « sortie supprimée » (annulée) ou « sortie confiée » (#1459) : sobre, un bouton si un lien existe.
 * Langue = compte du destinataire.
 */
export function outingNoticeMail(
  to: string, d: { kind: 'cancelled' | 'transferred'; who: string; title: string; date: string; url: string | null }, locale?: string | null,
): MailMessage {
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const t = translatorFor(lang) as unknown as (key: string, values?: Record<string, string>) => string;
  const k = d.kind === 'cancelled' ? 'mail.outingCancelled' : 'mail.outingTransferred';
  const button = d.url ? `<tr><td style="padding-bottom:24px"><a href="${esc(d.url)}" style="display:block;text-align:center;background:${c('primary')};color:${c('primary-foreground')};text-decoration:none;font-weight:560;font-size:16px;padding:14px 20px;border-radius:8px">${esc(t(`${k}.button`))}</a></td></tr>` : '';
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:${c('background')};font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:${c('foreground')}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${c('card')};border-radius:12px;padding:28px 24px;border:1px solid ${c('border')}">
<tr><td style="font-size:22px;font-weight:650;letter-spacing:-0.4px;padding-bottom:16px">Singletrack</td></tr>
<tr><td style="font-size:16px;line-height:1.5;padding-bottom:8px">${esc(t(`${k}.intro`, { who: d.who }))}</td></tr>
<tr><td style="font-size:20px;font-weight:700;padding-bottom:4px">${esc(d.title)}</td></tr>
<tr><td style="font-size:16px;color:${c('muted-foreground')};padding-bottom:24px">${esc(d.date)}</td></tr>
${button}
</table></td></tr></table></body></html>`;
  return {
    to,
    subject: t(`${k}.subject`, { title: d.title }),
    html,
    text: t(`${k}.text`, { who: d.who, title: d.title, date: d.date, url: d.url ?? '' }),
  };
}
