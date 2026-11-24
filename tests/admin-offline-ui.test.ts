import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import fr from '../messages/fr.json';
import { AdminOffline } from '@/components/admin/admin-offline';

// #1750: /admin/offline builds through buttons (offline-worker jobs), never shows a command.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const region = (id: string, built: boolean) => ({ id, name: id.toUpperCase(), bbox: [5, 43, 6, 44], enabled: built, sizeBytes: built ? 5e6 : null, version: built ? '20261101' : null, builtAt: built ? '2026-11-01T00:00:00Z' : null, segments: ['E5_N40'], built });
type Props = Parameters<typeof AdminOffline>[0];
const render = (p: Partial<Props>) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: 'fr', messages: fr, timeZone: 'Europe/Paris' },
  h(AdminOffline, { lastRefresh: null, usage: [], envEnabled: true, switchOn: true, freeBytes: null, regions: [], catalog: [], jobs: { builds: {}, refresh: null }, workerAlive: true, ...p })));

describe('AdminOffline (#1750)', () => {
  it('build / rebuild / retry buttons and job states, no command', () => {
    const html = render({
      regions: [region('aaa', false), region('bbb', true), region('ccc', false), region('ddd', false)],
      jobs: { builds: { ccc: { status: 'running', step: 'segments' }, ddd: { status: 'failed', step: 'map' } }, refresh: { status: 'queued', step: null } },
    });
    expect(html).toContain('>Construire<');
    expect(html).toContain('>Reconstruire<');
    expect(html).toContain('>Réessayer<');
    expect(html).toContain('Téléchargement des segments…');
    expect(html).toContain('Échec de la construction.');
    expect(html).toContain('En attente…');
    expect(html).toContain('Rafraîchir maintenant');
    expect(html).not.toMatch(/docker|npm run|offline:build|offline:refresh/);
    expect(html).not.toContain('Service de construction arrêté');
  });
  it('worker stopped: said, buttons disabled', () => {
    const html = render({ regions: [region('aaa', false)], workerAlive: false });
    expect(html).toContain('Service de construction arrêté.');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Construire</);
  });
});
