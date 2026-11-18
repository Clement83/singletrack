import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import fr from '../messages/fr.json';
import en from '../messages/en.json';
import { OutingView, type OutingViewOuting } from '@/components/outings/outing-view';
import { OutingParticipants } from '@/components/outings/outing-participants';
import type { TrackSnapshot } from '@/lib/outings/snapshot';

// La carte embarquée (MapLibre) n'a pas sa place dans un rendu serveur de test.
vi.mock('@/components/tracks/track-detail', () => ({ TrackDetail: () => h('div', { 'data-testid': 'track-detail' }) }));
vi.mock('@/components/outings/outing-route', () => ({ OutingRoute: () => h('div', { 'data-testid': 'outing-route' }) }));

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
  it('page : description dans la carte d\u2019identité (retours à la ligne conservés), RDV et itinéraire (#1619)', () => {
    const html = render({ organizerName: 'Clément' });
    expect(html).toContain('RDV chez moi\n+ pique-nique');
    expect(html).toContain('whitespace-pre-line');
    expect(html).toContain('line-clamp-3');
    expect(html).toContain('Organisée par Clément');
    expect(html).toMatch(/RDV\s:\sChez moi/);
    expect(html).toContain('google.com/maps/dir');
    expect(html).toContain('33');
  });

  it('aucun mot de l\u2019organisateur sans description ; lieu de repli sans libellé', () => {
    const html = render({ outing: { ...base, description: null, meetingLabel: null } });
    expect(html).not.toContain('whitespace-pre-line');
    expect(html).toMatch(/RDV\s:\spoint sur la carte/);
  });

  it('page : en-tête → identité → action principale → parcours → sections repliées → commentaires, pour les 4 rôles', () => {
    for (const role of ['organizer', 'guest', 'visitor', 'anonymous'] as const) {
      const html = render({ ...slots, role, headerMenu: h('i', null, 'MENU'), conditionsLine: h('i', null, 'LINE') });
      const order = ['MENU', 'Sortie du samedi', 'RDV chez moi', 'Chez moi', 'LINE', 'PARTICIPANTS', 'PRIMARY', 'Lac de la Verne', 'id="conditions-section"', 'CONDITIONS', 'id="activity-section"', 'ACTIVITY', 'SECONDARY', 'COMMENTS'];
      const at = order.map((x) => html.indexOf(x));
      expect(at.every((i) => i >= 0), role).toBe(true);
      expect([...at].sort((a, b) => a - b), role).toEqual(at);
      expect(html).toContain('data-testid="outing-route"');
      expect(html).toContain(`data-role="${role}"`);
    }
  });

  it('page : sections Conditions et Roulées repliées (details sans open), absentes sans contenu', () => {
    const html = render(slots);
    expect(html).toMatch(/<details id="conditions-section" class="[^"]*">/);
    expect(html).not.toContain(' open');
    const bare = render();
    expect(bare).not.toContain('conditions-section');
    expect(bare).not.toContain('activity-section');
  });

  it('panneau : jusqu’à « Qui vient », sans conditions, roulées, photos, commentaires ni carte', () => {
    const html = render({ ...slots, presentation: 'panel', role: 'visitor' });
    expect(html).toContain('PRIMARY');
    expect(html).toContain('PARTICIPANTS');
    for (const s of ['CONDITIONS', 'ACTIVITY', 'COMMENTS', 'SECONDARY', 'track-detail']) expect(html).not.toContain(s);
    expect(html).toContain('data-role="visitor"');
  });

  it('textes en anglais', () => {
    expect(render({ organizerName: 'Paul' }, 'en')).toContain('Organised by Paul');
  });
});

describe('OutingParticipants en ligne (#1619)', () => {
  const people = ['Paul', 'Léa', 'Max', 'Zoé', 'Tom'].map((name, i) => ({ id: `p${i}`, name, status: 'yes' as const, isMe: false, isOrganizer: false }));
  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(h(NextIntlClientProvider, { locale: 'fr', messages: fr, children: h(OutingParticipants, { participants: people, ...props }) }));
  it('« Paul, Léa, Max +2 viennent » ouvre le tiroir', () => {
    const out = html({ inline: true });
    expect(out).toContain('Paul, Léa, Max +2 viennent');
    expect(out).toContain('aria-haspopup="dialog"');
  });
  it('anonyme : le nombre seulement, aucun prénom', () => {
    const out = html({ countOnly: true });
    expect(out).toContain('5 participants');
    expect(out).not.toContain('Paul');
  });
});
