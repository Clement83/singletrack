'use client';

import { useEffect } from 'react';

/**
 * Enregistre le service worker (production uniquement, contexte sécurisé : HTTPS ou localhost).
 * En développement (#1464), désinscrit tout service worker déjà installé et vide ses caches :
 * sinon son cache-first sur `/_next/static` servirait des modules périmés et casserait le rechargement à chaud.
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
