// #1592: an outing may be more visible than its track (the frozen route is seen by whoever sees the outing).
// Pure functions, shared by the form (warning) and the pages (link to the track).

const TRACK_RANK: Record<string, number> = { private: 0, friends: 1, public: 2 };
const OUTING_RANK: Record<string, number> = { invite: 1, friends: 1, public: 2 };

/** True if the outing reaches more people than the original track. */
export function outingWiderThanTrack(outingVisibility: string, trackVisibility: string | null | undefined): boolean {
  return (OUTING_RANK[outingVisibility] ?? 2) > (TRACK_RANK[trackVisibility ?? 'public'] ?? 2);
}
