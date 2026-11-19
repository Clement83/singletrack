// Calendar subscription links (#1357), pure: usable on the client.

/** Subscription links from the https URL of the feed: webcal (iOS, macOS) and direct add to Google Calendar. */
export function subscribeLinks(httpsUrl: string): { https: string; webcal: string; google: string } {
  const webcal = httpsUrl.replace(/^https?:/, 'webcal:');
  return { https: httpsUrl, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}
