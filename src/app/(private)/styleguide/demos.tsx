'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, Link2, Plus, Share2, Trash2, Zap, Mountain } from 'lucide-react';
import { ElevationProfile } from '@/components/elevation-profile';
import { Button } from '@/components/ui/button';
import { Badge, DifficultyBadge, FireBadge, RsvpBadge } from '@/components/ui/badge';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { BottomNavBar, SideNavBar } from '@/components/app-nav';
import { RsvpPanel, type RsvpAnswer } from '@/components/rsvp-panel';
import { ConditionsBlock } from '@/components/conditions-block';
import { OutingView, type OutingViewRole } from '@/components/outings/outing-view';
import type { TrackSnapshot } from '@/lib/outings/snapshot';
import { OutingParticipants } from '@/components/outings/outing-participants';
import type { Participant } from '@/lib/outings/participants-summary';
import type { WeatherInfo } from '@/lib/weather';
import { TrackCard, TrackCardSkeleton } from '@/components/track-card';
import { DIFFICULTY, FIRE, RSVP, type Difficulty, type FireLevel, type Rsvp } from '@/lib/design/scales';

// Météo de démonstration (#1350) : une belle matinée, puis un jour de mistral qui finit de nuit après la pluie.
const NOW = Date.UTC(2026, 10, 16, 8);
const SUNNY: WeatherInfo = { kind: 'ok', sky: 'clear', tempMin: 12, tempMax: 15, windMax: 10, gustMax: 22, popMax: 5, rainMm: 0, rain48h: 0, sunset: NOW + 9 * 3600e3, endsAt: NOW + 3 * 3600e3, flags: [], tone: 'ok' };
const WINDY: WeatherInfo = { kind: 'ok', sky: 'cloudy', tempMin: 9, tempMax: 13, windMax: 38, gustMax: 66, popMax: 20, rainMm: 0.4, rain48h: 18, sunset: NOW + 9 * 3600e3, endsAt: NOW + 10 * 3600e3, flags: ['wind', 'dark', 'muddy'], tone: 'warn' };

const NAMES = ['Léa', 'Max', 'Tom', 'Inès', 'Hugo', 'Chloé', 'Nino', 'Zoé', 'Paul', 'Jade', 'Marc', 'Eva', 'Sam', 'Lou', 'Noé', 'Ana', 'Ben', 'Mia', 'Tim', 'Lola'];
const people = (n: number): Participant[] => [
  { id: 'o', name: 'Clément', status: 'yes', isMe: false, isOrganizer: true },
  ...NAMES.slice(0, Math.max(0, n - 1)).map((name, i) => ({ id: `p${i}`, name, status: (i % 7 === 5 ? 'maybe' : i % 7 === 6 ? 'no' : 'yes') as Participant['status'], isMe: i === 1, isOrganizer: false })),
];

// Sortie de démonstration (#1597) : mêmes blocs pour les 4 rôles, seules les actions changent.
const DEMO_TRACK = {
  slug: 'demo', name: 'Lac de la Verne', geometry: { type: 'LineString', coordinates: [[6.22, 43.2], [6.25, 43.22], [6.3, 43.21], [6.28, 43.18]] },
  bbox: [6.22, 43.18, 6.3, 43.22], start: [6.22, 43.2], distanceM: 33000, elevationGainM: 820, elevationLossM: 820, minEle: 40, maxEle: 420,
  difficulty: 'moyen', loop: true, source: 'user', attribution: null, license: null, sourceUrl: null, takenAt: '2026-11-01T00:00:00Z',
} as unknown as TrackSnapshot;
const DEMO_OUTING = {
  title: 'Lac de la Verne', startsAt: new Date(Date.UTC(2026, 10, 21, 8)), level: 'sportif', ebike: 'yes', meetingLabel: 'Chez Clément',
  meetingLat: 43.2, meetingLon: 6.22, description: 'RDV chez moi à 9 h.\nPique-nique tiré du sac.',
} as const;
const ROLE_ACTION: Record<OutingViewRole, string> = { organizer: 'Gérer la sortie', guest: 'GO', visitor: 'Rejoindre', anonymous: 'Se connecter' };

function Demo({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="flex flex-col gap-4">
      <h2 id={`${id}-t`} className="text-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

const PROFILE = Array.from({ length: 41 }, (_, i) => ({
  distKm: i * 0.5,
  ele: 180 + 90 * Math.sin(i / 5) + 40 * Math.sin(i / 2.3),
}));

const SUNDAY = new Date('2026-11-15T07:00:00Z');

export function ComponentDemos() {
  const [rsvp, setRsvp] = useState<RsvpAnswer | null>(null);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <Demo id="boutons" title="Boutons">
        <div className="flex flex-wrap gap-3">
          <Button>Principal</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="outline">Contour</Button>
          <Button variant="ghost">Fantôme</Button>
          <Button variant="destructive">
            <Trash2 aria-hidden />
            Annuler la sortie
          </Button>
          <Button disabled>Désactivé</Button>
          <Button variant="secondary" size="icon" aria-label="Partager">
            <Share2 />
          </Button>
        </div>
        <Button size="lg">
          <CalendarPlus aria-hidden />
          Créer la sortie
        </Button>
      </Demo>

      <Demo id="badges" title="Badges">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
            <DifficultyBadge key={d} level={d} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FIRE).map(Number) as FireLevel[]).map((f) => (
            <FireBadge key={f} level={f} detailed />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(RSVP) as Rsvp[]).map((r) => (
            <RsvpBadge key={r} status={r} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>
            <Mountain aria-hidden />
            Niveau confirmé
          </Badge>
          <Badge variant="primary">
            <Zap aria-hidden />
            VAE bienvenus
          </Badge>
          <Badge variant="success">Tout est bon</Badge>
          <Badge variant="warning">À surveiller</Badge>
          <Badge variant="danger">Massif fermé</Badge>
        </div>
      </Demo>

      <Demo id="champs" title="Champs">
        <div className="flex flex-col gap-4">
          <Field label="Nom de la sortie" hint="Court : on le lit sur WhatsApp.">
            {(p) => <Input {...p} placeholder="Boucle des Maures" />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">{(p) => <Input {...p} type="date" defaultValue="2026-11-15" />}</Field>
            <Field label="Heure">{(p) => <Input {...p} type="time" defaultValue="08:00" />}</Field>
          </div>
          <Field label="Niveau">
            {(p) => (
              <NativeSelect {...p} defaultValue="moyen">
                <option value="cool">Cool</option>
                <option value="moyen">Moyen</option>
                <option value="sportif">Sportif</option>
              </NativeSelect>
            )}
          </Field>
          <Field label="Nombre de places" error="Il faut au moins 1 place.">
            {(p) => <Input {...p} inputMode="numeric" defaultValue="0" />}
          </Field>
          <Field label="Mot pour les invités">{(p) => <Textarea {...p} placeholder="On part à 8 h pétantes." />}</Field>
        </div>
      </Demo>

      <Demo id="rsvp" title="Réponse de l'invité (RsvpPanel)">
        <div className="rounded-2xl border border-border bg-card p-4">
          <RsvpPanel name="Julien" value={rsvp} onChange={setRsvp} />
        </div>
      </Demo>

      <Demo id="conditions" title="Conditions (ConditionsBlock)">
        <ConditionsBlock />
        <ConditionsBlock weather={SUNNY} fire={1} hunting={{ kind: 'closed', tone: 'ok' }} />
        <ConditionsBlock weather={WINDY} fire={3} hunting={{ kind: 'general', tone: 'caution', until: '2027-02-28' }} />
        <ConditionsBlock weather={{ kind: 'beyond', availableFrom: NOW + 12 * 24 * 3600e3 }} />
      </Demo>

      <Demo id="participants" title="Qui vient (OutingParticipants)">
        <OutingParticipants participants={[]} />
        <OutingParticipants participants={[]} organizer />
        <OutingParticipants participants={people(2)} />
        <OutingParticipants participants={people(3)} />
        <OutingParticipants participants={people(20)} />
        <OutingParticipants participants={people(9)} max={10} />
      </Demo>

      <Demo id="sortie" title="Vue de sortie (OutingView)">
        {(['organizer', 'guest', 'visitor', 'anonymous'] as const).map((role) => (
          <div key={role} className="flex flex-col gap-3 rounded-2xl border border-border p-4">
            <p className="text-small font-semibold text-muted-foreground">{role} · page</p>
            <OutingView
              role={role}
              presentation="page"
              outing={DEMO_OUTING}
              track={DEMO_TRACK}
              primaryAction={<Button>{ROLE_ACTION[role]}</Button>}
              participants={<OutingParticipants participants={people(4)} max={10} organizer={role === 'organizer'} />}
              secondaryActions={role === 'organizer' || role === 'guest' ? <Button variant="outline"><Share2 aria-hidden /> Partager</Button> : undefined}
              comments={<p className="text-small text-muted-foreground">Commentaires…</p>}
            />
          </div>
        ))}
        <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
          <p className="text-small font-semibold text-muted-foreground">panel (sans carte, conditions, roulées, commentaires)</p>
          <OutingView role="visitor" presentation="panel" outing={DEMO_OUTING} track={DEMO_TRACK} primaryAction={<Button>{ROLE_ACTION.visitor}</Button>} participants={<OutingParticipants participants={people(4)} />} />
        </div>
      </Demo>

      <Demo id="cartes" title="Traces et sorties (TrackCard)">
        <div className="flex flex-col gap-3">
          <TrackCard
            href="#cartes"
            title="Boucle des Maures par le col de Fourche"
            distanceKm={32.1}
            elevationM={662}
            difficulty="blue"
            loop
            source="OpenStreetMap"
          />
          <TrackCard href="#cartes" title="Sortie du dimanche" distanceKm={24.5} elevationM={480} difficulty="red" date={SUNDAY} going={4} />
          <TrackCardSkeleton />
        </div>
      </Demo>

      <Demo id="nav" title="Navigation">
        <p className="text-small text-muted-foreground">Mobile : barre du bas. Desktop (≥ 1024 px) : barre latérale.</p>
        <BottomNavBar active="/sorties" className="rounded-2xl border" />
        <SideNavBar active="/" className="h-72 rounded-2xl border" />
      </Demo>

      <Demo id="sheet" title="Bottom sheet">
        <p className="text-small text-muted-foreground">3 crans sur mobile, panneau latéral sur desktop.</p>
        <Button variant="secondary" onClick={() => setSheet(true)}>
          Ouvrir le sheet
        </Button>
        <BottomSheet
          open={sheet}
          onOpenChange={setSheet}
          title="Boucle des Maures"
          description="32,1 km · 662 m D+"
          footer={<Button size="lg">GO</Button>}
        >
          <div className="flex flex-col gap-block">
            <div className="flex gap-2">
              <DifficultyBadge level="blue" />
              <FireBadge level={1} />
            </div>
            <ConditionsBlock weather={SUNNY} fire={1} />
            <p>RDV au parking de Pierrefeu, on part à 8 h pétantes.</p>
          </div>
        </BottomSheet>
      </Demo>

      <Demo id="confirm" title="Confirmation (ConfirmDialog)">
        <p className="text-small text-muted-foreground">Remplace le confirm du navigateur : tiroir mobile, bouton principal, choix secondaire optionnel, annuler.</p>
        <Button variant="secondary" onClick={() => setConfirm(true)}>
          Ouvrir la confirmation
        </Button>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Quitter l’éditeur ?"
          description="Tu as des modifications non enregistrées."
          confirmLabel="Enregistrer"
          destructive={false}
          onConfirm={() => setConfirm(false)}
          secondary={{ label: 'Quitter sans enregistrer', onClick: () => setConfirm(false), destructive: true }}
          cancelLabel="Rester"
        />
      </Demo>

      <Demo id="retours" title="Toasts, états vides, chargement">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast.success('Lien copié')}>
            <Link2 aria-hidden />
            Copier le lien
          </Button>
          <Button variant="secondary" onClick={() => toast.error('Pas de réseau. Réessaie dans un instant.')}>
            Toast d’erreur
          </Button>
        </div>
        <div className="rounded-2xl border border-border bg-card">
          <EmptyState
            icon={CalendarPlus}
            title="Aucune sortie prévue"
            action={
              <Button size="lg">
                <Plus aria-hidden />
                On en crée une ?
              </Button>
            }
          >
            Choisis une trace, une date, et invite tes potes.
          </EmptyState>
        </div>
        <div className="rounded-2xl border border-border bg-card">
          <EmptyState icon={Link2} tone="error" title="Ce lien n’est plus valable">
            Demande-en un nouveau à l’organisateur.
          </EmptyState>
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </Demo>
      <Demo id="profil" title="Profil altimétrique (au doigt)">
        <ElevationProfile points={PROFILE} />
      </Demo>
    </>
  );
}
