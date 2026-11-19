// Domain scales of the design system (#1363). A scale colour is never shown without
// its label: labels in the translation catalogues (`scales.*`, #1401), colours here.
// Tailwind classes are written in full so they are detected at build time.

export type Difficulty = 'green' | 'blue' | 'red' | 'black';
export const DIFFICULTY: Record<Difficulty, { dot: string }> = {
  green: { dot: 'bg-diff-green' },
  blue: { dot: 'bg-diff-blue' },
  red: { dot: 'bg-diff-red' },
  black: { dot: 'bg-diff-black' },
};

/** Access levels to the massifs (Var prefecture map). */
export type FireLevel = 1 | 2 | 3 | 4 | 5;
export const FIRE: Record<FireLevel, { dot: string }> = {
  1: { dot: 'bg-fire-1' },
  2: { dot: 'bg-fire-2' },
  3: { dot: 'bg-fire-3' },
  4: { dot: 'bg-fire-4' },
  5: { dot: 'bg-fire-5' },
};

export type Rsvp = 'yes' | 'maybe' | 'no' | 'pending';
export const RSVP: Record<Rsvp, { dot: string }> = {
  yes: { dot: 'bg-rsvp-yes' },
  maybe: { dot: 'bg-rsvp-maybe' },
  no: { dot: 'bg-rsvp-no' },
  pending: { dot: 'bg-rsvp-no' },
};
