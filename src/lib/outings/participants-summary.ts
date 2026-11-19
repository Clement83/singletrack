// "Who's coming" summary (#1468): pure (no database), usable on the client and on the server.
export type ParticipantStatus = 'yes' | 'maybe' | 'no' | 'pending';

/** Participant as displayed: first name only, never an email or a token. */
export type Participant = { id: string; name: string; status: ParticipantStatus; isMe: boolean; isOrganizer: boolean };

export const PREVIEW_COUNT = 3;

export type ParticipantsSummary = {
  counts: Record<ParticipantStatus, number>;
  /** The first 3 (coming, then maybe) in the order received. */
  preview: Participant[];
  /** Number of "coming / maybe" not in the preview. */
  others: number;
  /** Not everything is already visible in the preview: the drawer is needed. */
  needsSheet: boolean;
};

export function summarizeParticipants(list: Participant[]): ParticipantsSummary {
  const counts: Record<ParticipantStatus, number> = { yes: 0, maybe: 0, no: 0, pending: 0 };
  for (const p of list) counts[p.status]++;
  const coming = [...list.filter((p) => p.status === 'yes'), ...list.filter((p) => p.status === 'maybe')];
  const preview = coming.slice(0, PREVIEW_COUNT);
  return { counts, preview, others: coming.length - preview.length, needsSheet: list.length > preview.length };
}

/** Initial of the first name (avatar). */
export function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : '?';
}
