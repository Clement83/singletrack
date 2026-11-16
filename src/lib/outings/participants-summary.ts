// Résumé « Qui vient » (#1468) : pur (sans base), utilisable côté client comme côté serveur.
export type ParticipantStatus = 'yes' | 'maybe' | 'no' | 'pending';

/** Participant tel qu'affiché : prénom seulement, jamais d'email ni de token. */
export type Participant = { id: string; name: string; status: ParticipantStatus; isMe: boolean; isOrganizer: boolean };

export const PREVIEW_COUNT = 3;

export type ParticipantsSummary = {
  counts: Record<ParticipantStatus, number>;
  /** Les 3 premiers (viennent, puis peut-être) dans l'ordre reçu. */
  preview: Participant[];
  /** Nombre de « viennent / peut-être » hors aperçu. */
  others: number;
  /** Tout n'est pas déjà visible dans l'aperçu : il faut le tiroir. */
  needsSheet: boolean;
};

export function summarizeParticipants(list: Participant[]): ParticipantsSummary {
  const counts: Record<ParticipantStatus, number> = { yes: 0, maybe: 0, no: 0, pending: 0 };
  for (const p of list) counts[p.status]++;
  const coming = [...list.filter((p) => p.status === 'yes'), ...list.filter((p) => p.status === 'maybe')];
  const preview = coming.slice(0, PREVIEW_COUNT);
  return { counts, preview, others: coming.length - preview.length, needsSheet: list.length > preview.length };
}

/** Initiale du prénom (avatar). */
export function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : '?';
}
