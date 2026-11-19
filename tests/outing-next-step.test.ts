import { describe, expect, it } from 'vitest';
import { nextStep, type NextStepInput } from '@/lib/outings/next-step';

// 2026-11-22 08:30 Paris = 07:30 UTC
const startsAt = new Date('2026-11-22T07:30:00Z');
const base: NextStepInput = { role: 'guest', past: false, startsAt, now: new Date('2026-11-10T10:00:00Z'), meetingLabel: 'Parking', organizerName: 'Paul', locale: 'fr' };

describe('nextStep invité', () => {
  it('passée + je viens ⇒ ajouter photos/roulée', () => expect(nextStep({ ...base, past: true, answer: 'yes' }).kind).toBe('addRide'));
  it('passée sinon ⇒ voir les N photos', () => {
    const s = nextStep({ ...base, past: true, answer: 'no', photoCount: 4 });
    expect(s).toMatchObject({ kind: 'seePhotos', titleKey: 'seePhotos', params: { count: 4 } });
    expect(nextStep({ ...base, past: true, answer: 'no', photoCount: 1 }).titleKey).toBe('seePhotoOne');
    expect(nextStep({ ...base, past: true, answer: 'no' }).titleKey).toBe('seePhotosNone');
  });
  it('pas de réponse ⇒ répondre à l’organisateur', () => {
    expect(nextStep({ ...base, answer: 'pending' })).toMatchObject({ kind: 'answer', params: { name: 'Paul' } });
    expect(nextStep({ ...base, role: 'anonymous', answer: null }).kind).toBe('answer');
  });
  it('peut-être ⇒ confirmer', () => expect(nextStep({ ...base, answer: 'maybe' }).kind).toBe('confirm'));
  it('non ⇒ changer ma réponse', () => expect(nextStep({ ...base, answer: 'no' }).kind).toBe('changeAnswer'));
  it('je viens ⇒ RDV, jour et heure de Paris', () => {
    const s = nextStep({ ...base, answer: 'yes' });
    expect(s).toMatchObject({ kind: 'meeting', contextKey: 'meetingWhen', params: { place: 'Parking', time: '08:30' } });
    expect(String(s.params.day)).toContain('dimanche');
  });
  it('je viens, le jour même ⇒ « Départ dans X h » (fuseau Paris)', () => {
    // 22 Nov 00:30 UTC = 01:30 Paris, same day as the 08:30 Paris start: 7 h
    const s = nextStep({ ...base, answer: 'yes', now: new Date('2026-11-22T00:30:00Z') });
    expect(s).toMatchObject({ contextKey: 'meetingSoon', params: { hours: 7 } });
    // 21 Nov 23:30 UTC = 00:30 Paris on the 22nd: still the same day
    expect(nextStep({ ...base, answer: 'yes', now: new Date('2026-11-21T23:30:00Z') }).contextKey).toBe('meetingSoon');
    // 21 Nov 22:30 UTC = 23:30 Paris on the 21st: the day before
    expect(nextStep({ ...base, answer: 'yes', now: new Date('2026-11-21T22:30:00Z') }).contextKey).toBe('meetingWhen');
  });
});

describe('nextStep organisateur', () => {
  const org: NextStepInput = { ...base, role: 'organizer' };
  it('passée ⇒ importer sa roulée', () => expect(nextStep({ ...org, past: true, pendingGuests: ['Hugo'] }).kind).toBe('importRide'));
  it('invités sans réponse ⇒ relancer (1, 2, 3+)', () => {
    expect(nextStep({ ...org, pendingGuests: ['Hugo'] })).toMatchObject({ kind: 'remind', titleKey: 'remindOne', contextKey: 'pendingGuestsOne', params: { a: 'Hugo', count: 1 } });
    expect(nextStep({ ...org, pendingGuests: ['Hugo', 'Inès'] })).toMatchObject({ titleKey: 'remindTwo', params: { a: 'Hugo', b: 'Inès' } });
    expect(nextStep({ ...org, pendingGuests: ['Hugo', 'Inès', 'A', 'B'] })).toMatchObject({ titleKey: 'remindMany', params: { others: 2, count: 4 } });
  });
  it('sinon ⇒ RDV', () => expect(nextStep({ ...org, pendingGuests: [] }).kind).toBe('meeting'));
});
