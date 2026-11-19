'use client';

import { toast } from 'sonner';
import { Check, Copy, Layers, LocateFixed, Minus, Mountain, Pencil, Plus, Route, Share2, Trash2 } from 'lucide-react';
import { LazyMap } from '@/components/lazy-map';
import { Button } from '@/components/ui/button';
import { DifficultyBadge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Mock-up of the Singletrack charter foundations (#1645): materials over a real map,
// interaction states, concentric radii, light and dark side by side.

const HOME = { lat: 43.2, lon: 6.25 };

function MapButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} className="press flex size-touch items-center justify-center rounded-xl border border-border glass shadow-md hover:bg-muted/60">
      {children}
    </button>
  );
}

/** Real map + floating glass layers: map buttons, menu, toast, sheet. */
export function MaterialsDemo() {
  return (
    <div className="relative h-[560px] overflow-hidden rounded-2xl border border-border">
      <LazyMap lat={HOME.lat} lon={HOME.lon} zoom={12} interactive={false} className="size-full" />

      <div className="absolute top-3 right-3 flex flex-col gap-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border glass shadow-md">
          <button type="button" aria-label="Zoomer" className="press flex size-touch items-center justify-center hover:bg-muted/60">
            <Plus aria-hidden className="size-5" />
          </button>
          <span aria-hidden className="mx-2 h-px bg-border" />
          <button type="button" aria-label="Dézoomer" className="press flex size-touch items-center justify-center hover:bg-muted/60">
            <Minus aria-hidden className="size-5" />
          </button>
        </div>
        <MapButton label="Me localiser">
          <LocateFixed aria-hidden className="size-5" />
        </MapButton>
        <MapButton label="Fonds de carte">
          <Layers aria-hidden className="size-5" />
        </MapButton>
      </div>

      <div className="absolute top-3 left-3 w-60 rounded-2xl border border-border glass p-1 shadow-md" role="menu" aria-label="Menu de démonstration">
        {[
          { icon: Pencil, label: 'Modifier une copie' },
          { icon: Copy, label: 'Copier le lien' },
          { icon: Share2, label: 'Partager' },
        ].map(({ icon: Icon, label }) => (
          <button key={label} type="button" role="menuitem" className="press concentric flex min-h-touch w-full items-center gap-3 px-3 text-left text-small font-medium hover:bg-muted/70">
            <Icon aria-hidden className="size-4 text-muted-foreground" />
            {label}
          </button>
        ))}
        <span aria-hidden className="mx-3 my-1 block h-px bg-border" />
        <button type="button" role="menuitem" className="press concentric flex min-h-touch w-full items-center gap-3 px-3 text-left text-small font-medium text-destructive hover:bg-destructive-soft">
          <Trash2 aria-hidden className="size-4" />
          Supprimer
        </button>
      </div>

      <div className="absolute inset-x-3 bottom-[212px] flex justify-center">
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-border glass px-4 py-3 text-small text-popover-foreground shadow-md">
          <Check aria-hidden className="size-4 text-success" />
          Lien copié
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 rounded-t-3xl border border-b-0 border-border glass px-4 pt-2 pb-4 text-card-foreground shadow-sheet">
        <span aria-hidden className="mx-auto h-1 w-9 rounded-full bg-muted-foreground/40" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-label text-muted-foreground uppercase">Boucle · Var</p>
            <h3 className="text-title">Lac de la Verne</h3>
          </div>
          <DifficultyBadge level="blue" />
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {[
            { icon: Route, label: 'Distance', value: '33,0 km' },
            { icon: Mountain, label: 'D+', value: '820 m' },
            { icon: Mountain, label: 'Point haut', value: '420 m' },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-xl bg-muted/60 px-3 py-2">
              <dt className="flex items-center gap-1 text-caption text-muted-foreground">
                <Icon aria-hidden className="size-3.5" />
                {label}
              </dt>
              <dd className="text-stat">{value}</dd>
            </div>
          ))}
        </dl>
        <Button size="lg" className="press" onClick={() => toast('Lien copié')}>
          Préparer une sortie
        </Button>
      </div>
    </div>
  );
}

/** Same content card in light and dark, side by side (local `data-theme` attribute). */
export function ThemePair() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {(['light', 'dark'] as const).map((theme) => (
        <div key={theme} data-theme={theme} className="flex flex-col gap-3 rounded-2xl bg-background p-3 text-foreground">
          <p className="text-label text-muted-foreground uppercase">{theme === 'light' ? 'Clair' : 'Sombre'}</p>
          <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-heading">Dimanche 22 novembre</h3>
              <span className="rounded-md bg-accent px-2 py-0.5 text-caption font-medium text-accent-foreground">Publique</span>
            </div>
            <p className="text-small text-muted-foreground">RDV parking de Pierrefeu · 8 h 30</p>
            <p className="text-stat">33,0 km · 820 m D+</p>
            <div className="flex gap-2">
              <Button className="press flex-1">Je viens</Button>
              <Button variant="secondary" className="press">
                Peut-être
              </Button>
            </div>
          </article>
        </div>
      ))}
    </div>
  );
}

/** States: rest, hover (desktop), press (spring), keyboard focus, disabled. */
export function StatesDemo() {
  const state = 'press flex min-h-touch items-center justify-center rounded-xl border px-4 text-small font-semibold';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <button type="button" className={cn(state, 'border-border bg-card shadow-sm hover:bg-muted')}>
          Repos · survol
        </button>
        <button type="button" className={cn(state, 'border-border bg-muted')}>
          Appuyé
        </button>
        <button type="button" className={cn(state, 'border-border bg-card outline-2 outline-offset-2 outline-ring')}>
          Focus clavier
        </button>
        <button type="button" disabled className={cn(state, 'border-border bg-card opacity-50')}>
          Désactivé
        </button>
      </div>
      <p className="text-small text-muted-foreground">
        Appui : <code>press</code> (échelle 0,97, <code>ease-spring</code>, 120 ms). Survol en desktop seulement, jamais seul porteur d’une action.
      </p>
    </div>
  );
}

/** Ranked and concentric radii: 16 → 12 → 8 with a 4 px inset. */
export function ConcentricDemo() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="rounded-3xl border border-border bg-card p-1 shadow-sm">
        <div className="rounded-2xl bg-muted p-1">
          <div className="flex h-16 w-40 items-center justify-center rounded-lg bg-primary text-small font-semibold text-primary-foreground">16 · 12 · 8</div>
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-2 shadow-sm [--inset:8px]">
        <div className="concentric flex h-16 w-40 items-center justify-center bg-accent text-small font-semibold text-accent-foreground">concentric (12 − 8)</div>
      </div>
    </div>
  );
}
