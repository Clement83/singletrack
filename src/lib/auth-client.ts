'use client';
import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({ plugins: [emailOTPClient()] });

/** Clé de message (`auth.errors.*`, messages/<langue>.json) d'une erreur de connexion par code (#1377, #1400). */
export type OtpErrorKey = 'rateLimited' | 'invalidCode' | 'expired' | 'tooManyAttempts' | 'invalidEmail' | 'generic';

export function otpError(e: { code?: string; status?: number }): OtpErrorKey {
  if (e.status === 429) return 'rateLimited';
  switch (e.code) {
    case 'INVALID_OTP':
      return 'invalidCode';
    case 'OTP_EXPIRED':
      return 'expired';
    case 'TOO_MANY_ATTEMPTS':
      return 'tooManyAttempts';
    case 'INVALID_EMAIL':
      return 'invalidEmail';
    default:
      return 'generic';
  }
}
