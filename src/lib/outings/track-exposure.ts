// #1592 : une sortie peut être plus visible que sa trace (le parcours figé est vu de ceux qui voient la sortie).
// Fonctions pures, partagées par le formulaire (avertissement) et les pages (lien vers la trace).

const TRACK_RANK: Record<string, number> = { private: 0, friends: 1, public: 2 };
const OUTING_RANK: Record<string, number> = { invite: 1, friends: 1, public: 2 };

/** Vrai si la sortie touche plus de monde que la trace d'origine. */
export function outingWiderThanTrack(outingVisibility: string, trackVisibility: string | null | undefined): boolean {
  return (OUTING_RANK[outingVisibility] ?? 2) > (TRACK_RANK[trackVisibility ?? 'public'] ?? 2);
}
