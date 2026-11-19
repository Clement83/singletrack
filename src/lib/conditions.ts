import type { FireInfo, FireTone } from '@/lib/fire';
import type { HuntingInfo } from '@/lib/hunting';
import type { WeatherInfo } from '@/lib/weather';

/**
 * Overall verdict of the "Conditions" block (#1350) from its independent providers (weather, fire,
 * hunting later). A provider without data ("not available", out of season…) is neutral:
 * it does not prevent "all good" if another provider gives reassuring information.
 */
export type OverallTone = 'ok' | 'warn' | 'danger' | 'unknown';

export function overallTone(input: { fire?: FireTone; weather?: WeatherInfo }): OverallTone {
  const tones: ('ok' | 'warn' | 'danger')[] = [];
  if (input.fire === 'ok') tones.push('ok');
  if (input.fire === 'warn' || input.fire === 'danger') tones.push(input.fire);
  if (input.weather?.kind === 'ok') tones.push(input.weather.tone);
  if (tones.includes('danger')) return 'danger';
  if (tones.includes('warn')) return 'warn';
  return tones.length ? 'ok' : 'unknown';
}

/**
 * Level of an item of the compact block (#1454), one coloured icon per provider:
 * `ok` green, `warn` orange, `danger` red, `black` black (fire level 5), `none` grey (no data, outside the Var).
 */
export type TileLevel = 'ok' | 'warn' | 'danger' | 'black' | 'none';

export function weatherLevel(weather?: WeatherInfo): TileLevel {
  return weather?.kind === 'ok' ? weather.tone : 'none';
}

/** Fire: levels 1-2 green, 3 orange, 4 red, 5 black; "no massif crossed" green; the rest grey. */
export function fireTileLevel(input: { fireInfo?: FireInfo; fire?: 1 | 2 | 3 | 4 | 5; outsideVar?: boolean }): TileLevel {
  if (input.outsideVar) return 'none';
  const info = input.fireInfo;
  if (info) {
    if (info.kind === 'none') return 'ok';
    if (info.kind !== 'ok') return 'none';
  }
  const level = info ? (info.kind === 'ok' ? info.worst : undefined) : input.fire;
  if (!level) return 'none';
  return level <= 2 ? 'ok' : level === 3 ? 'warn' : level === 4 ? 'danger' : 'black';
}

/** Hunting: green = no hunting that day, orange = hunting or driven-hunt day, grey = unknown. No effect on the verdict. */
export function huntingTileLevel(hunting?: HuntingInfo, outsideVar?: boolean): TileLevel {
  if (outsideVar || !hunting) return 'none';
  return hunting.tone === 'ok' ? 'ok' : hunting.tone === 'caution' ? 'warn' : 'none';
}
