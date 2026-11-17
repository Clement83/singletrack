import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import type { Position } from '@/lib/geo';

// #1593 : /t/<slug> redirige vers la carte avec la trace ouverte ; non visible ⇒ 404, sans redirection.
const state = vi.hoisted(() => ({ db: null as unknown, userId: undefined as string | undefined }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => ({ db: state.db }) }));
vi.mock('@/lib/current-user', () => ({ getCurrentUser: async () => (state.userId ? { id: state.userId } : null) }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error('NOT_FOUND'); },
}));

const coords: Position[] = Array.from({ length: 30 }, (_, i) => [6.14 + i * 0.001, 43.22 + (i % 3) * 0.0005, 100 + i * 2] as Position);

async function make(visibility: 'public' | 'private', status: 'published' | 'draft' = 'published') {
  const db = (state.db as ReturnType<typeof openDb>['db']);
  const r = await upsertTrack(db, { source: 'gpx', externalId: null, name: 'T', geometry: { type: 'LineString', coordinates: coords }, raw: null, createdBy: 'author', status, visibility }, { enrich: false });
  return (r as { slug: string }).slug;
}

async function run(slug: string) {
  const { default: Page } = await import('@/app/t/[slug]/page');
  return Page({ params: Promise.resolve({ slug }) }).then(() => 'rendered', (e: Error) => e.message);
}

describe('/t/<slug> (#1593)', () => {
  beforeEach(() => {
    const { db } = openDb(':memory:');
    const now = new Date();
    for (const id of ['author', 'other']) db.insert(user).values({ id, name: id, email: `${id}@x.fr`, emailVerified: true, createdAt: now, updatedAt: now }).run();
    state.db = db;
    state.userId = undefined;
  });

  it('trace publique : redirection vers la carte, anonyme comme connecté', async () => {
    const slug = await make('public');
    expect(await run(slug)).toBe(`REDIRECT:/?t=${slug}`);
    state.userId = 'other';
    expect(await run(slug)).toBe(`REDIRECT:/?t=${slug}`);
  });

  it('trace privée : 404 sauf pour son auteur', async () => {
    const slug = await make('private');
    expect(await run(slug)).toBe('NOT_FOUND');
    state.userId = 'other';
    expect(await run(slug)).toBe('NOT_FOUND');
    state.userId = 'author';
    expect(await run(slug)).toBe(`REDIRECT:/?t=${slug}`);
  });

  it('brouillon d’autrui et slug inconnu : 404', async () => {
    const slug = await make('public', 'draft');
    state.userId = 'other';
    expect(await run(slug)).toBe('NOT_FOUND');
    expect(await run('inconnu')).toBe('NOT_FOUND');
  });
});
