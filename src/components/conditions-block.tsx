import { useFormatter, useLocale, useTranslations } from 'next-intl';
import {
  ExternalLink, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Crosshair, Flame, Sun,
  TriangleAlert, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FireBadge } from '@/components/ui/badge';
import type { FireLevel } from '@/lib/design/scales';
import { fireMessage, isFireBlocked, type FireInfo } from '@/lib/fire';
import type { Sky, WeatherInfo, WeatherOk } from '@/lib/weather';
import { fireTileLevel, huntingTileLevel, overallTone, weatherLevel } from '@/lib/conditions';
import { OVERALL } from '@/components/overall-tone';
import { FireBanner, OfficialLink } from '@/components/fire/fire-banner';
import { ConditionsTiles, type Tile } from '@/components/conditions-tiles';
import { HUNTING_MAPS, HUNTING_RULES_URL, type HuntingInfo } from '@/lib/hunting';

type Props = {
  /** Météo sur le créneau de la sortie (#1350, `outingWeather`). Absente = pas encore branchée. */
  weather?: WeatherInfo;
  /** Niveau d'accès au massif le plus restrictif du parcours (#1349). */
  fire?: FireLevel;
  /** Situation incendie complète à la date de la sortie (#1349) : prioritaire sur `fire`. */
  fireInfo?: FireInfo;
  /** Saison de chasse et battues possibles à la date de la sortie (#1354, `huntingInfo`). */
  hunting?: HuntingInfo;
  /** Sortie hors du Var : incendie et chasse n'ont de source que départementale (#1428) → « non disponible ». */
  outsideVar?: boolean;
  className?: string;
};

export const SKY_ICON: Record<Sky, LucideIcon> = {
  clear: Sun, cloudy: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning,
};


function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-small text-muted-foreground">{children}</span>;
}

/** Détail météo d'une prévision disponible : ciel et températures, vent, pluie. */
function WeatherDetail({ w }: { w: WeatherOk }) {
  const t = useTranslations('weather');
  const format = useFormatter();
  const n = (v: number | null, digits = 0) => (v === null ? '—' : format.number(v, { maximumFractionDigits: digits }));
  return (
    <span className="flex flex-col items-end gap-0.5 tabular-nums">
      <span className="font-semibold">
        {[w.sky && t(`sky.${w.sky}`), w.tempMin !== null && t('temp', { min: n(w.tempMin), max: n(w.tempMax) })].filter(Boolean).join(' · ')}
      </span>
      <Muted>{t('wind', { wind: n(w.windMax), gust: n(w.gustMax) })}</Muted>
      <Muted>{t('rain', { pop: n(w.popMax), mm: n(w.rainMm, 1) })}</Muted>
    </span>
  );
}

/** Alertes météo (orage, pluie, vent, nuit, terrain gras), toujours icône + texte. */
function WeatherFlags({ w }: { w: WeatherOk }) {
  const t = useTranslations('weather');
  const format = useFormatter();
  const time = (ms: number) => format.dateTime(new Date(ms), { hour: '2-digit', minute: '2-digit' });
  if (!w.flags.length) return null;
  return (
    <ul className={cn('mt-2 flex flex-col gap-1.5 rounded-2xl p-3 text-small', w.tone === 'danger' ? 'bg-destructive-soft text-destructive' : 'bg-warning-soft text-warning')}>
      {w.flags.map((f) => (
        <li key={f} className="flex items-start gap-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {f === 'wind'
              ? t('flags.wind', { gust: format.number(Math.round(w.gustMax ?? 0)) })
              : f === 'dark'
                ? t('flags.dark', { end: time(w.endsAt), sunset: time(w.sunset ?? w.endsAt) })
                : f === 'muddy'
                  ? t('flags.muddy', { mm: format.number(w.rain48h ?? 0, { maximumFractionDigits: 0 }) })
                  : t(`flags.${f}`)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Ligne « Chasse » : situation du jour, et jusqu'à quand. */
function HuntingDetail({ h }: { h: HuntingInfo }) {
  const t = useTranslations('hunting');
  const format = useFormatter();
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className={cn(h.tone === 'caution' && 'font-semibold')}>{t(`short.${h.kind}`)}</span>
      {h.until && (
        <Muted>{t('until', { date: format.dateTime(new Date(`${h.until}T12:00:00Z`), { day: 'numeric', month: 'long' }) })}</Muted>
      )}
    </span>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center gap-1.5 text-small font-semibold underline underline-offset-2 hover:opacity-80 active:opacity-70">
      {children} <ExternalLink aria-hidden className="size-4" />
    </a>
  );
}

/** Message de prudence et cartes de battues de référence, les jours où la chasse est ouverte. */
function HuntingCaution() {
  const t = useTranslations('hunting');
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-2xl bg-muted p-3 text-small">
      <p className="flex items-start gap-2">
        <Crosshair aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{t('caution')}</span>
      </p>
      <p className="text-muted-foreground">{t('noData')}</p>
      <p className="flex flex-wrap items-center gap-x-4">
        <span className="font-semibold">{t('maps')}</span>
        {HUNTING_MAPS.map((m) => (
          <ExtLink key={m.url} href={m.url}>
            {m.name}
          </ExtLink>
        ))}
      </p>
      <ExtLink href={HUNTING_RULES_URL}>{t('rules')}</ExtLink>
    </div>
  );
}

/**
 * Bloc « Conditions » d'une sortie, compact (#1454) : titre + verdict, puis trois icônes de niveau (météo, incendie,
 * chasse) qui ouvrent chacune leur fiche détaillée. Chaque rubrique est un fournisseur indépendant : sans donnée,
 * elle est grise et ne casse pas le bloc. La chasse ne change pas le verdict.
 */
export function ConditionsBlock({ weather, fire, fireInfo, hunting, outsideVar, className }: Props) {
  const t = useTranslations('conditions');
  const tw = useTranslations('weather');
  const th = useTranslations('hunting');
  const format = useFormatter();
  const tf = useTranslations('fire');
  const locale = useLocale();
  const msg = fireInfo ? fireMessage(fireInfo, tf, locale) : undefined;
  const level = fireInfo ? (fireInfo.kind === 'ok' ? fireInfo.worst : undefined) : fire;
  const fireTone = msg?.tone ?? (fire === undefined ? undefined : fire <= 2 ? 'ok' : fire === 3 ? 'warn' : 'danger');
  const tone = overallTone({ fire: fireTone, weather });
  const verdict = OVERALL[tone];
  // La chasse ne change pas le verdict (sinon « À surveiller » sept mois par an) : elle retire seulement le fond vert.
  const allGood = tone === 'ok' && hunting?.tone !== 'caution';
  const w = weather?.kind === 'ok' ? weather : undefined;
  const WeatherIcon = w?.sky ? SKY_ICON[w.sky] : CloudSun;
  const tileIcon = (Icon: LucideIcon) => <Icon aria-hidden className="size-6" strokeWidth={1.75} />;

  const weatherSummary = !weather
    ? t('notYet')
    : weather.kind === 'ok'
      ? [w?.sky && tw(`sky.${w.sky}`), w && w.tempMin !== null && tw('temp', { min: format.number(w.tempMin, { maximumFractionDigits: 0 }), max: format.number(w.tempMax ?? w.tempMin, { maximumFractionDigits: 0 }) })].filter(Boolean).join(' · ') || tw('source')
      : weather.kind === 'beyond'
        ? tw('beyond', { date: format.dateTime(new Date(weather.availableFrom), { weekday: 'long', day: 'numeric', month: 'long' }) })
        : tw(weather.kind);
  const fireSummary = outsideVar ? t('varOnly') : msg?.short ?? (level ? tf('short.ok') : t('notYet'));
  const huntingSummary = outsideVar ? t('varOnly') : hunting ? th(`short.${hunting.kind}`) : t('notYet');

  const tiles: Tile[] = [
    {
      id: 'weather', label: t('weather'), icon: tileIcon(WeatherIcon), level: weatherLevel(weather), summary: weatherSummary,
      detail: (
        <div className="flex flex-col gap-2">
          {!weather ? (
            <Muted>{t('notYet')}</Muted>
          ) : weather.kind === 'ok' ? (
            <>
              <WeatherDetail w={weather} />
              <WeatherFlags w={weather} />
              <p className="text-caption text-muted-foreground">{tw('source')}</p>
            </>
          ) : (
            <Muted>{weatherSummary}</Muted>
          )}
        </div>
      ),
    },
    {
      id: 'fire', label: t('fire'), icon: tileIcon(Flame), level: fireTileLevel({ fireInfo, fire, outsideVar }), summary: fireSummary,
      detail: (
        <div className="flex flex-col gap-2">
          {outsideVar ? (
            <Muted>{t('varOnly')}</Muted>
          ) : (
            <>
              {msg?.banner && <FireBanner message={msg} />}
              {!msg?.banner && (level ? <FireBadge level={level} detailed /> : msg ? <Muted>{msg.short}</Muted> : <Muted>{t('notYet')}</Muted>)}
              {fireInfo && !isFireBlocked(fireInfo) && !msg?.banner && (
                <div className="flex flex-col gap-1">
                  {msg?.note && <p className="text-small text-muted-foreground">{msg.note}</p>}
                  <OfficialLink />
                </div>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      id: 'hunting', label: t('hunting'), icon: tileIcon(Crosshair), level: huntingTileLevel(hunting, outsideVar), summary: huntingSummary,
      detail: (
        <div className="flex flex-col gap-2">
          {outsideVar ? <Muted>{t('varOnly')}</Muted> : hunting ? <HuntingDetail h={hunting} /> : <Muted>{t('notYet')}</Muted>}
          {!outsideVar && hunting?.tone === 'caution' && <HuntingCaution />}
          {!outsideVar && hunting && hunting.tone !== 'caution' && (
            <>
              <p className="text-small text-muted-foreground">{th('noData')}</p>
              <ExtLink href={HUNTING_RULES_URL}>{th('rules')}</ExtLink>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <section
      aria-labelledby="conditions-title"
      className={cn('rounded-2xl border border-border p-4', allGood ? 'bg-success-soft' : 'bg-card', className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="conditions-title" className="text-heading">
          {t('title')}
        </h3>
        <p className={cn('flex items-center gap-2 font-semibold', verdict.className)}>
          <verdict.icon aria-hidden className="size-5 shrink-0 self-center" />
          {t(`overall.${tone}`)}
        </p>
      </div>
      <ConditionsTiles tiles={tiles} />
    </section>
  );
}
