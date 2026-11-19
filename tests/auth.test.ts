import { describe, it, expect, vi, afterEach } from 'vitest';
import { openDb } from '@/db';
import { createAuth, signUpDisabled } from '@/lib/auth';
import { sendMail, type MailMessage } from '@/lib/mail';
import { signInCodeMail, signInLink } from '@/lib/mail-templates';
import { safeNext } from '@/lib/safe-next';
import { createUser } from '@/lib/users';
import { isPublicPath } from '@/lib/public-routes';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';

async function setup(opts: { disableSignUp?: boolean } = {}) {
  const { db } = openDb(':memory:');
  const mails: MailMessage[] = [];
  const auth = createAuth(db, { disableSignUp: opts.disableSignUp ?? false, mailer: async (m) => void mails.push(m) });
  await createUser(auth, { email: 'Clem@Example.org', name: 'Clem' });
  /** Requests a code and reads it back from the captured email (sending happens in the background). */
  async function requestCode(email: string) {
    const before = mails.length;
    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
    await vi.waitFor(() => expect(mails.length).toBe(before + 1));
    return mails.at(-1)!.subject.slice(0, 6);
  }
  return { db, auth, mails, requestCode };
}

const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

describe('connexion sans mot de passe (#1377)', () => {
  it('envoie un code et ouvre la session avec ce code', async () => {
    const { auth, mails, requestCode } = await setup();
    const otp = await requestCode('clem@example.org');
    expect(otp).toMatch(/^\d{6}$/);
    expect(mails[0].to).toBe('clem@example.org');
    expect(mails[0].text).toContain(otp);
    const res = await auth.api.signInEmailOTP({ body: { email: 'clem@example.org', otp }, asResponse: true });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join()).toMatch(/HttpOnly/i);
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieOf(res) }) });
    expect(session?.user.name).toBe('Clem');
  });

  it("le code ne sert qu'une fois, et un mauvais code est refusé", async () => {
    const { auth, requestCode } = await setup();
    const otp = await requestCode('clem@example.org');
    const wrong = otp === '000000' ? '111111' : '000000';
    await expect(auth.api.signInEmailOTP({ body: { email: 'clem@example.org', otp: wrong } })).rejects.toThrow();
    await expect(auth.api.signInEmailOTP({ body: { email: 'clem@example.org', otp } })).resolves.toBeTruthy();
    await expect(auth.api.signInEmailOTP({ body: { email: 'clem@example.org', otp } })).rejects.toThrow();
  });

  it('bloque le code après 3 essais ratés', async () => {
    const { auth, requestCode } = await setup();
    const otp = await requestCode('clem@example.org');
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) await expect(auth.api.signInEmailOTP({ body: { email: 'clem@example.org', otp: wrong } })).rejects.toThrow();
    await expect(auth.api.signInEmailOTP({ body: { email: 'clem@example.org', otp } })).rejects.toThrow();
  });

  it('crée le compte (sans prénom) à la première connexion d’un email inconnu, un seul compte par email', async () => {
    const { auth, requestCode } = await setup();
    const otp = await requestCode('Neo@Y.fr'.toLowerCase());
    const res = await auth.api.signInEmailOTP({ body: { email: 'neo@y.fr', otp }, asResponse: true });
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieOf(res) }) });
    expect(session?.user).toMatchObject({ email: 'neo@y.fr', name: '', emailVerified: true });
    const otp2 = await requestCode('neo@y.fr');
    const res2 = await auth.api.signInEmailOTP({ body: { email: 'neo@y.fr', otp: otp2 }, asResponse: true });
    const s2 = await auth.api.getSession({ headers: new Headers({ cookie: cookieOf(res2) }) });
    expect(s2?.user.id).toBe(session?.user.id);
  });

  it("n'envoie rien à un email inconnu quand les inscriptions sont fermées", async () => {
    const { auth, mails } = await setup({ disableSignUp: true });
    await expect(auth.api.sendVerificationOTP({ body: { email: 'x@y.fr', type: 'sign-in' } })).resolves.toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(mails).toHaveLength(0);
    process.env.AUTH_DISABLE_SIGNUP = 'true';
    try {
      expect(signUpDisabled()).toBe(true);
    } finally {
      delete process.env.AUTH_DISABLE_SIGNUP;
    }
  });

  it("n'accepte plus de connexion par mot de passe", async () => {
    const { auth } = await setup();
    const call = () => auth.api.signInEmail({ body: { email: 'clem@example.org', password: 'motdepasse1' } });
    await expect(call()).rejects.toThrow();
  });

  it('CLI : refuse un doublon', async () => {
    const { auth } = await setup();
    await expect(createUser(auth, { email: 'clem@example.org', name: 'B' })).rejects.toThrow(/existe déjà/);
  });
});

describe('mail de connexion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
  });

  it('le lien du mail porte la page d\'origine (#1595), revalidée par safeNext', () => {
    const url = signInLink('https://x.org', 'a@b.fr', '123456', '/?t=abc&z=12');
    expect(url).toBe('https://x.org/login/lien#e=a%40b.fr&c=123456&n=%2F%3Ft%3Dabc%26z%3D12');
    expect(safeNext(new URLSearchParams(url.split('#')[1]).get('n'))).toBe('/?t=abc&z=12');
    expect(safeNext('https://evil.example')).toBeUndefined();
    expect(signInLink('https://x.org', 'a@b.fr', '123456')).not.toContain('n=');
  });

  it('contient le code, le lien (code dans le fragment) et un QR code inline', async () => {
    const url = signInLink('https://singletrack.example.org/', 'a+b@c.fr', '123456');
    expect(url).toBe('https://singletrack.example.org/login/lien#e=a%2Bb%40c.fr&c=123456');
    const m = await signInCodeMail('a+b@c.fr', '123456', url, 10);
    expect(m.subject).toMatch(/^123456/);
    expect(m.html).toContain('123456');
    expect(m.html).toContain('href="https://singletrack.example.org/login/lien#e=a%2Bb%40c.fr&amp;c=123456"');
    expect(m.html).toContain('src="cid:qr"');
    expect(m.attachments?.[0]).toMatchObject({ contentId: 'qr', filename: 'connexion.png' });
    expect(Buffer.from(m.attachments![0].content, 'base64').subarray(1, 4).toString()).toBe('PNG');
  });

  it("appelle l'API Resend (pièce jointe inline comprise), et n'envoie rien sans clé", async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msg = { to: 'a@b.fr', subject: 's', html: 'h', text: 't', attachments: [{ filename: 'q.png', content: 'AA==', contentId: 'qr' }] };
    await sendMail(msg);
    expect(fetchMock).not.toHaveBeenCalled();
    warn.mockRestore();
    process.env.RESEND_API_KEY = 're_test';
    await sendMail(msg);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ['a@b.fr'], attachments: [{ filename: 'q.png', content: 'AA==', content_id: 'qr' }] });
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 403 }));
    await expect(sendMail(msg)).rejects.toThrow(/403/);
  });
});

describe('routes publiques / privées', () => {
  it.each(['/login', '/login/lien', '/s/abc', '/t/abc', '/i/tok', '/api/auth/sign-in/email', '/api/health', '/api/s/abc', '/api/t/abc', '/api/i/tok', '/api/s/abc/join', '/offline', '/sw.js', '/manifest.webmanifest', '/icons/a.png', '/icon.svg', '/api/locale'])(
    '%s est publique',
    (p) => expect(isPublicPath(p)).toBe(true),
  );
  it.each(['/sorties', '/styleguide', '/api/tracks', '/api/outings', '/api/outings/x/invitations', '/sorties/new', '/login-evil', '/bienvenue', '/sorties-s'])('%s est privée', (p) =>
    expect(isPublicPath(p)).toBe(false),
  );

  const req = (path: string, cookie?: string) =>
    new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

  it('redirige vers /login sans cookie de session (la carte / est publique depuis #1591)', async () => {
    const res = (await proxy(req('/sorties')));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/login');
  });
  it('répond 401 aux API privées sans session', async () => {
    expect((await proxy(req('/api/tracks/segments'))).status).toBe(401);
  });
  it('laisse passer /s/<slug> sans session et le privé avec cookie', async () => {
    expect((await proxy(req('/s/abc'))).headers.get('location')).toBeNull();
    expect((await proxy(req('/', 'better-auth.session_token=x'))).headers.get('location')).toBeNull();
  });
});

