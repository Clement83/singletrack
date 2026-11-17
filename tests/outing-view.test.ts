import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import fr from '../messages/fr.json';
import en from '../messages/en.json';
import { OutingView, type OutingViewOuting } from '@/components/outings/outing-view';
import type { TrackSnapshot } from '@/lib/outings/snapshot';

// La carte embarquée (MapLibre) n'a pas sa place dans un rendu serveur de test.
vi.mock('@/components/tracks/track-detail', () => ({ TrackDetail: () => h('div', { 'data-testid': 'track-detail' }) }));

const snap = {
  slug: 'abc', name: 'Lac de la Verne', geometry: { type: 'LineString', coordinates: [[6.1, 43.2], [6.2, 43.3]] }, bbox: [6.1, 43.2, 6.2, 43.3],
  start: [6.1, 43.2], distanceM: 33000, elevationGainM: 800, attribution: null, license: null, takenAt: '2026-11-01T00:00:00Z',
} as unknown as TrackSnapshot;
const base: OutingViewOuting = {
  title: 'Sortie du samedi', startsAt: new Date('2026-11-21T08:00:00Z'), level: 'sportif', ebike: 'yes',
  meetingLabel: 'Chez moi', meetingLat: 43.2, meetingLon: 6.1, description: 'RDV chez moi\n+ pique-nique',
} as OutingViewOuting;

const render = (props: Partial<Parameters<typeof OutingView>[0]> = {}, locale: 'fr' | 'en' = 'fr') =>
  renderToStaticMarkup(h(NextIntlClientProvider, { locale, messages: locale === 'fr' ? fr : en, timeZone: 'Europe/Paris', children: h(OutingView, { role: 'organizer', presentation: 'page', outing: base, track: snap, ...props }) }));

const slots = { primaryAction: h('i', null, 'PRIMARY'), conditions: h('i', null, 'CONDITIONS'), participants: h('i', null, 'PARTICIPANTS'), secondaryActions: h('i', null, 'SECONDARY'), activity: h('i', null, 'ACTIVITY'), comments: h('i', null, 'COMMENTS') };

describe('OutingView', () => {
  it('affiche la description (retours à la ligne conservés) et le lieu du RDV (#1597)', () => {
    const html = render();
    expect(html).toContain('RDV chez moi\n+ pique-nique');
    expect(html).toContain('whitespace-pre-line');
    expect(html).toMatch(/RDV\s:\sChez moi/);
    expect(html).toContain('google.com/maps/dir');
  });

  it('aucun bloc vide sans description ; lieu de repli sans libellé', () => {
    const html = render({ outing: { ...base, description: null, meetingLabel: null } });
    expect(html).not.toContain('whitespace-pre-line');
    expect(html).toMatch(/RDV\s:\spoint sur la carte/);
  });

  it('même ordre de blocs en présentation page', () => {
    const html = render(slots);
    const order = ['Sortie du samedi', 'PRIMARY', 'Chez moi', 'RDV chez moi', 'Lac de la Verne', 'CONDITIONS', 'PARTICIPANTS', 'SECONDARY', 'ACTIVITY', 'COMMENTS'];
    const at = order.map((s) => html.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('data-testid="track-detail"');
  });

  it('panneau : jusqu’à « Qui vient », sans conditions, roulées, photos, commentaires ni carte', () => {
    const html = render({ ...slots, presentation: 'panel', role: 'visitor' });
    expect(html).toContain('PRIMARY');
    expect(html).toContain('PARTICIPANTS');
    for (const s of ['CONDITIONS', 'ACTIVITY', 'COMMENTS', 'SECONDARY', 'track-detail']) expect(html).not.toContain(s);
    expect(html).toContain('data-role="visitor"');
  });

  it('textes en anglais', () => {
    expect(render({}, 'en')).toContain('Meeting point');
  });
});
