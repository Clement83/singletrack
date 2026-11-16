/**
 * Envoi de mails via Resend (#1376) — API HTTP, sans dépendance.
 * Sans RESEND_API_KEY (dev, tests), le mail n'est pas envoyé : une ligne de log seulement (sans le code).
 */
export type MailAttachment = { filename: string; content: string /* base64 */; contentId?: string /* image inline : src="cid:…" */ };
export type MailMessage = { to: string; subject: string; html: string; text: string; attachments?: MailAttachment[] };
export type Mailer = (m: MailMessage) => Promise<void>;

export const sendMail: Mailer = async (m) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[mail] RESEND_API_KEY absente : mail « ${m.subject} » non envoyé`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? 'Singletrack <no-reply@example.org>',
      to: [m.to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content, content_id: a.contentId })),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`[mail] Resend ${res.status} : ${(await res.text()).slice(0, 200)}`);
};

/** Envoi sans attendre (la réponse HTTP ne dépend pas du mail : pas de fuite par le temps de réponse). */
export function sendInBackground(mailer: Mailer, m: MailMessage | Promise<MailMessage>) {
  Promise.resolve(m)
    .then(mailer)
    .catch((e) => console.error(e instanceof Error ? e.message : e));
}
