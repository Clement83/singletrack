import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP } from 'better-auth/plugins';
import { getDb, type Db } from '@/db';
import * as schema from '@/db/schema';
import { sendInBackground, sendMail, type Mailer } from './mail';
import { eq } from 'drizzle-orm';
import { LOCALE_COOKIE, resolveLocale } from '@/i18n/config';
import { ensureHandle } from './federation/handle';
import { safeNext } from './safe-next';
import { signInCodeMail, signInLink } from './mail-templates';

export const OTP_MINUTES = 10;

/**
 * Better Auth, PASSWORDLESS sign-in (#1377): the email receives a 6-digit code, a link and a QR code.
 * One account per email; unknown email ⇒ account created on first sign-in (first name asked on /bienvenue),
 * unless AUTH_DISABLE_SIGNUP=true. Accounts can also be created with `npm run user:create`.
 * httpOnly session cookie; `secure` through AUTH_SECURE_COOKIES=true (HTTPS, #1374).
 * Rate limiting (production) per IP, read from the X-Forwarded-For set by nginx.
 */
export function signUpDisabled() {
  return process.env.AUTH_DISABLE_SIGNUP === 'true';
}

/** Language of the sign-in email (#1401): the account's if it exists, otherwise the one of the page asking for the code. */
export function mailLocale(db: Db, email: string, headers?: Headers | null) {
  const known = db.select({ locale: schema.user.locale }).from(schema.user).where(eq(schema.user.email, email.toLowerCase())).get()?.locale;
  if (known) return known;
  const cookie = headers?.get('cookie')?.split(';').map((c) => c.trim().split('=')).find(([k]) => k === LOCALE_COOKIE)?.[1];
  return resolveLocale({ cookie, acceptLanguage: headers?.get('accept-language') });
}

export function createAuth(db: Db = getDb().db, opts: { disableSignUp?: boolean; mailer?: Mailer } = {}) {
  const mailer = opts.mailer ?? sendMail;
  const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-secret-change-me-in-env-0123456789',
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: process.env.AUTH_TRUSTED_ORIGINS?.split(',').filter(Boolean),
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    emailAndPassword: { enabled: false },
    // Long session: no new code asked on every outing.
    session: { expiresIn: 60 * 24 * 3600, updateAge: 24 * 3600 },
    rateLimit: {
      enabled: process.env.NODE_ENV === 'production',
      // Per IP: 10 code sends per hour, 10 code attempts per minute (on top of the 3 attempts per code).
      customRules: {
        '/email-otp/send-verification-otp': { window: 3600, max: 10 },
        '/sign-in/email-otp': { window: 60, max: 10 },
      },
    },
    // Federated handle (#1474): generated as soon as the account has a first name (CLI creation, or entered on /bienvenue), never from the email.
    databaseHooks: {
      user: {
        create: { after: async (u) => void ensureHandle(db, u.id) },
        update: { after: async (u) => void (u && ensureHandle(db, u.id)) },
      },
    },
    advanced: { useSecureCookies: process.env.AUTH_SECURE_COOKIES === 'true' },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: OTP_MINUTES * 60,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        disableSignUp: opts.disableSignUp ?? signUpDisabled(),
        async sendVerificationOTP({ email, otp, type }, ctx) {
          if (type !== 'sign-in') return;
          const locale = mailLocale(db, email, ctx?.request?.headers ?? ctx?.headers);
          sendInBackground(mailer, signInCodeMail(email, otp, signInLink(baseUrl, email, otp, safeNext(headerOf(ctx, NEXT_HEADER))), OTP_MINUTES, locale));
        },
      }),
      nextCookies(),
    ],
  });
}

/** Header carrying the original page when the code is sent (#1595): Better Auth only passes email + type. */
export const NEXT_HEADER = 'x-login-next';
function headerOf(ctx: { request?: Request; headers?: Headers } | null | undefined, name: string) {
  return ctx?.request?.headers?.get(name) ?? ctx?.headers?.get(name) ?? undefined;
}

export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | undefined;
/** Single instance per process, created on demand (no database opened at build time). */
export function getAuth() {
  cached ??= createAuth();
  return cached;
}
