import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { user } from '@/db/schema';
import { getCurrentUser } from '@/lib/current-user';
import { LOCALE_COOKIE, isLocale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

/**
 * Change language (#1400): `POST {locale: 'fr' | 'en'}`. Public (a guest without an account can change it too).
 * Sets the NEXT_LOCALE cookie (1 year) and, if someone is signed in, saves the account preference
 * (language of their emails). The client then reloads the page (`router.refresh()`).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { locale?: unknown } | null;
  const locale = body?.locale;
  if (!isLocale(locale)) return NextResponse.json({ error: 'invalid_locale' }, { status: 400 });
  const me = await getCurrentUser();
  if (me) getDb().db.update(user).set({ locale, updatedAt: new Date() }).where(eq(user.id, me.id)).run();
  const res = NextResponse.json({ locale });
  res.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.AUTH_SECURE_COOKIES === 'true',
  });
  return res;
}
