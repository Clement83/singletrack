'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loginHref } from '@/lib/login-href';

/**
 * Link to sign-in that then comes back to the current view (#1591). The map view changes through `replaceState`
 * (#1577): so the return address is read on click, not on render.
 */
export function LoginLink({ onClick, ...props }: Omit<React.ComponentProps<typeof Link>, 'href'>) {
  const router = useRouter();
  return (
    <Link
      {...props}
      href="/login"
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(loginHref(window.location));
      }}
    />
  );
}
