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
  /** Weather over the outing's slot (#1350, `outingWeather`). Absent = not wired yet. */
  weather?: WeatherInfo;
  /** Most restrictive massif access level along the route (#1349). */
  fire?: FireLevel;
  /** Full fire situation on the outing's date (#1349): takes precedence over `fire`. */
  fireInfo?: FireInfo;
  /** Hunting season and possible driven hunts on the outing's date (#1354, `huntingInfo`). */
  hunting?: HuntingInfo;
  /** Outing outside the Var: fire and hunting only have departmental sources (#1428) → "not available". */
  outsideVar?: boolean;
  className?: string;
};

export const SKY_ICON: Record<Sky, LucideIcon> = {
  clear: Sun, cloudy: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning,
};


function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-small text-muted-foreground">{children}</span>;
}

/** Weather detail of an available forecast: sky and temperatures, wind, rain. */
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

/** Weather alerts (storm, rain, wind, night, muddy ground), always icon + text. */
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

/** "Hunting" line: situation of the day, and until when. */
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

/** Caution message and reference driven-hunt maps, on the days hunting is open. */
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
 * Verdict of the conditions (weather + fire), shown right of the title of the collapsed "Conditions" section (#1638).
 * Hunting does not change the verdict (otherwise "To watch" seven months a year).
 */
export function ConditionsSummary({ weather, fire, fireInfo }: Pick<Props, 'weather' | 'fire' | 'fireInfo'>) {
  const t = useTranslations('conditions');
  const tf = useTranslations('fire');
  const locale = useLocale();
  const msg = fireInfo ? fireMessage(fireInfo, tf, locale) : undefined;
  const fireTone = msg?.tone ?? (fire === undefined ? undefined : fire <= 2 ? 'ok' : fire === 3 ? 'warn' : 'danger');
  const tone = overallTone({ fire: fireTone, weather });
  const verdict = OVERALL[tone];
  return (
    <span className={cn('flex items-center gap-2 font-semibold', verdict.className)}>
      <verdict.icon aria-hidden className="size-5 shrink-0" />
      {t(`overall.${tone}`)}
    </span>
  );
}

/**
 * Content of an outing's "Conditions" section (#1454, #1638): three level icons (weather, fire, hunting)
 * each opening its detailed card. The title and the verdict are carried by the section (`OutingSection`).
 * Each item is an independent provider: without data it is grey and does not break the block.
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
    <div className={className}>
      <ConditionsTiles tiles={tiles} />
    </div>
  );
}

/**
 * "Conditions" line of the outing's identity card (#1619): sky icon, sky · temperatures and verdict
 * dot (weather + fire). The detail is in the collapsed "Conditions" section.
 */
export function ConditionsLine({ weather, fire, fireInfo }: Pick<Props, 'weather' | 'fire' | 'fireInfo'>) {
  const t = useTranslations('conditions');
  const tw = useTranslations('weather');
  const tf = useTranslations('fire');
  const format = useFormatter();
  const locale = useLocale();
  const msg = fireInfo ? fireMessage(fireInfo, tf, locale) : undefined;
  const fireTone = msg?.tone ?? (fire === undefined ? undefined : fire <= 2 ? 'ok' : fire === 3 ? 'warn' : 'danger');
  const tone = overallTone({ fire: fireTone, weather });
  const verdict = OVERALL[tone];
  const w = weather?.kind === 'ok' ? weather : undefined;
  const Icon = w?.sky ? SKY_ICON[w.sky] : CloudSun;
  const round = (v: number) => format.number(v, { maximumFractionDigits: 0 });
  const text = w
    ? [w.sky && tw(`sky.${w.sky}`), w.tempMin !== null && tw('temp', { min: round(w.tempMin), max: round(w.tempMax ?? w.tempMin) })].filter(Boolean).join(' · ')
    : t(`overall.${tone}`);
  return (
    <>
      <Icon aria-hidden className="size-6 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-body tabular-nums">{text}</span>
      <verdict.icon aria-hidden className={cn('size-5 shrink-0', verdict.className)} />
      <span className="sr-only">{t(`overall.${tone}`)}</span>
    </>
  );
}
