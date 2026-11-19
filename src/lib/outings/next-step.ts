import { utcToParisInputs } from '@/lib/outings/time';

/** The reader's answer to the invitation (`pending` / `null` = not answered yet). */
export type NextStepAnswer = 'yes' | 'maybe' | 'no' | 'pending' | null;

export type NextStepInput = {
  role: 'organizer' | 'guest' | 'visitor' | 'anonymous';
  answer?: NextStepAnswer;
  /** Past outing (grace period included). */
  past: boolean;
  /** First names of the guests who have not answered (organiser). */
  pendingGuests?: string[];
  organizerName?: string;
  meetingLabel?: string | null;
  startsAt: Date;
  now: Date;
  photoCount?: number;
  locale?: string;
};

export type NextStepKind = 'addRide' | 'seePhotos' | 'answer' | 'confirm' | 'changeAnswer' | 'importRide' | 'remind' | 'meeting';

export type NextStep = {
  kind: NextStepKind;
  titleKey: string;
  contextKey?: string;
  params: Record<string, string | number>;
};

const TZ = 'Europe/Paris';

/** "Starts in X h" on the same day (Paris), otherwise "<day> · <time>". */
function meetingStep(i: NextStepInput): NextStep {
  const locale = i.locale === 'en' ? 'en-GB' : 'fr-FR';
  const place = i.meetingLabel ?? '';
  const sameDay = utcToParisInputs(i.startsAt).date === utcToParisInputs(i.now).date;
  if (sameDay && i.startsAt.getTime() > i.now.getTime()) {
    const hours = Math.max(1, Math.ceil((i.startsAt.getTime() - i.now.getTime()) / 3_600_000));
    return { kind: 'meeting', titleKey: 'meeting', contextKey: 'meetingSoon', params: { place, hours } };
  }
  const day = new Intl.DateTimeFormat(locale, { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(i.startsAt);
  const time = new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(i.startsAt);
  return { kind: 'meeting', titleKey: 'meeting', contextKey: 'meetingWhen', params: { place, day, time } };
}

/** Next step of the outing for this reader (#1620): the first rule that applies. Pure, no database access. */
export function nextStep(i: NextStepInput): NextStep {
  if (i.role === 'organizer') {
    if (i.past) return { kind: 'importRide', titleKey: 'importRide', params: {} };
    const pending = i.pendingGuests ?? [];
    if (pending.length > 0) {
      const [a, b] = pending;
      const titleKey = pending.length === 1 ? 'remindOne' : pending.length === 2 ? 'remindTwo' : 'remindMany';
      return { kind: 'remind', titleKey, contextKey: pending.length === 1 ? 'pendingGuestsOne' : 'pendingGuests', params: { a, b: b ?? '', others: pending.length - 2, count: pending.length } };
    }
    return meetingStep(i);
  }
  const answer = i.answer ?? 'pending';
  if (i.past) {
    if (answer === 'yes') return { kind: 'addRide', titleKey: 'addRide', params: {} };
    const count = i.photoCount ?? 0;
    return { kind: 'seePhotos', titleKey: count === 0 ? 'seePhotosNone' : count === 1 ? 'seePhotoOne' : 'seePhotos', params: { count } };
  }
  if (answer === 'pending') return { kind: 'answer', titleKey: 'answer', params: { name: i.organizerName ?? '' } };
  if (answer === 'maybe') return { kind: 'confirm', titleKey: 'confirm', params: {} };
  if (answer === 'no') return { kind: 'changeAnswer', titleKey: 'changeAnswer', params: {} };
  return meetingStep(i);
}
