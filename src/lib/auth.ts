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
import { signInCodeMail, signInLink } from './mail-templates';

export const OTP_MINUTES = 10;

/**
 * Better Auth, connexion SANS mot de passe (#1377) : l'email reçoit un code à 6 chiffres, un lien et un QR code.
 * Un compte par email ; email inconnu ⇒ compte créé à la première connexion (prénom demandé sur /bienvenue),
 * sauf si AUTH_DISABLE_SIGNUP=true. Comptes aussi créables par `npm run user:create`.
 * Cookie de session httpOnly ; `secure` via AUTH_SECURE_COOKIES=true (HTTPS, #1374).
 * Rate limiting (production) par IP, lue dans X-Forwarded-For posé par nginx.
 */
export function signUpDisabled() {
  return process.env.AUTH_DISABLE_SIGNUP === 'true';
}

/** Langue du mail de connexion (#1401) : celle du compte s'il existe, sinon celle de la page qui demande le code. */
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
    // Session longue : on ne redemande pas un code à chaque sortie.
    session: { expiresIn: 60 * 24 * 3600, updateAge: 24 * 3600 },
    rateLimit: {
      enabled: process.env.NODE_ENV === 'production',
      // Par IP : 10 envois de code par heure, 10 essais de code par minute (en plus des 3 essais par code).
      customRules: {
        '/email-otp/send-verification-otp': { window: 3600, max: 10 },
        '/sign-in/email-otp': { window: 60, max: 10 },
      },
    },
    // Handle fédéré (#1474) : généré dès que le compte a un prénom (création en CLI, ou saisie sur /bienvenue), jamais depuis l'email.
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
          sendInBackground(mailer, signInCodeMail(email, otp, signInLink(baseUrl, email, otp), OTP_MINUTES, locale));
        },
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | undefined;
/** Instance unique par processus, créée à la demande (pas d'ouverture de base au build). */
export function getAuth() {
  cached ??= createAuth();
  return cached;
}
