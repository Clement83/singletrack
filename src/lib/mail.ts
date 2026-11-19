/**
 * Sending emails through Resend (#1376) — HTTP API, no dependency.
 * Without RESEND_API_KEY (dev, tests), the email is not sent: a log line only (without the code).
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

/** Sends without waiting (the HTTP response does not depend on the email: no leak through response time). */
export function sendInBackground(mailer: Mailer, m: MailMessage | Promise<MailMessage>) {
  Promise.resolve(m)
    .then(mailer)
    .catch((e) => console.error(e instanceof Error ? e.message : e));
}
