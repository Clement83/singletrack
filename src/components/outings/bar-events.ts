export const OPEN_INVITE_EVENT = 'outing:open-invite';
export const OPEN_RESPOND_EVENT = 'outing:open-respond';

/** Opens the "Rides and photos" section (collapsed by default) and scrolls to it. */
export function openActivity() {
  const el = document.getElementById('activity-section');
  if (!(el instanceof HTMLDetailsElement)) return;
  el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
