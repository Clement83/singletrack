export const OPEN_INVITE_EVENT = 'outing:open-invite';
export const OPEN_RESPOND_EVENT = 'outing:open-respond';

/** Ouvre la section « Roulées et photos » (repliée par défaut) et y amène l'écran. */
export function openActivity() {
  const el = document.getElementById('activity-section');
  if (!(el instanceof HTMLDetailsElement)) return;
  el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
