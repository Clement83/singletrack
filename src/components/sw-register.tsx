'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (production only, secure context: HTTPS or localhost).
 * In development (#1464), unregisters any service worker already installed and empties its caches:
 * otherwise its cache-first on `/_next/static` would serve stale modules and break hot reload.
 */
export function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
      if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);
  return null;
}
