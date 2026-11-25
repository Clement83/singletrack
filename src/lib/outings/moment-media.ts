/** Photos taken within this delay of a key moment, and videos starting within it, are featured with it (#1798). */
export const MOMENT_WINDOW_MS = 2 * 60_000;

export type MomentRef = { id: string; at: number | null };
export type MomentMediaRef = { id: string; type: 'photo' | 'video'; takenAt: number | null; durationMs: number | null };

/**
 * Media to feature at a key moment: a photo taken ≤ 2 min from it, a video that covers it or starts ≤ 2 min from it.
 * Undated moments or media match nothing. Returns, per moment id, the media ids ordered by closeness to the moment;
 * a media matching several moments goes to the closest one only.
 */
export function mediaAroundMoments(moments: MomentRef[], media: MomentMediaRef[]): Map<string, string[]> {
  const out = new Map<string, { id: string; gap: number }[]>();
  for (const m of media) {
    if (m.takenAt == null) continue;
    let best: { moment: string; gap: number } | null = null;
    for (const mo of moments) {
      if (mo.at == null) continue;
      const covers = m.type === 'video' && m.durationMs != null && m.takenAt <= mo.at && mo.at <= m.takenAt + m.durationMs;
      const gap = covers ? 0 : Math.abs(m.takenAt - mo.at);
      if (!covers && gap > MOMENT_WINDOW_MS) continue;
      if (!best || gap < best.gap) best = { moment: mo.id, gap };
    }
    if (best) out.set(best.moment, [...(out.get(best.moment) ?? []), { id: m.id, gap: best.gap }]);
  }
  return new Map([...out].map(([k, v]) => [k, v.sort((a, b) => a.gap - b.gap).map((x) => x.id)]));
}
