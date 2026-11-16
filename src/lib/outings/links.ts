// Liens d'abonnement agenda (#1357), purs : utilisables côté client.

/** Liens d'abonnement à partir de l'URL https du flux : webcal (iOS, macOS) et ajout direct à Google Agenda. */
export function subscribeLinks(httpsUrl: string): { https: string; webcal: string; google: string } {
  const webcal = httpsUrl.replace(/^https?:/, 'webcal:');
  return { https: httpsUrl, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}
