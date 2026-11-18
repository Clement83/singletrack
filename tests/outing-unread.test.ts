import { describe, expect, it } from 'vitest';
import { countUnread } from '@/lib/outings/unread';

const c = (createdAt: string, mine = false) => ({ createdAt, mine });

describe('countUnread (#1622)', () => {
  it('sans ouverture connue : tous les messages des autres', () => {
    expect(countUnread([c('2026-11-01T10:00:00Z'), c('2026-11-01T11:00:00Z', true)], null)).toBe(1);
  });
  it('seuls les messages postérieurs à la dernière ouverture comptent', () => {
    const list = [c('2026-11-01T10:00:00Z'), c('2026-11-01T12:00:00Z'), c('2026-11-01T13:00:00Z', true)];
    expect(countUnread(list, '2026-11-01T11:00:00Z')).toBe(1);
    expect(countUnread(list, '2026-11-01T12:00:00Z')).toBe(0);
  });
  it('date illisible : tout est non lu', () => {
    expect(countUnread([c('2026-11-01T10:00:00Z')], 'n/a')).toBe(1);
  });
});
