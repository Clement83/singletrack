import type { FireInfo, FireTone } from '@/lib/fire';
import type { HuntingInfo } from '@/lib/hunting';
import type { WeatherInfo } from '@/lib/weather';

/**
 * Verdict global du bloc « Conditions » (#1350) à partir de ses fournisseurs indépendants (météo, incendie,
 * chasse plus tard). Un fournisseur sans donnée (« non disponible », hors saison…) est neutre :
 * il n'empêche pas « tout est bon » si un autre fournisseur donne une info rassurante.
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
 * Niveau d'une rubrique du bloc compact (#1454), une icône colorée par fournisseur :
 * `ok` vert, `warn` orange, `danger` rouge, `black` noir (incendie niveau 5), `none` gris (pas de donnée, hors du Var).
 */
export type TileLevel = 'ok' | 'warn' | 'danger' | 'black' | 'none';

export function weatherLevel(weather?: WeatherInfo): TileLevel {
  return weather?.kind === 'ok' ? weather.tone : 'none';
}

/** Incendie : niveaux 1-2 vert, 3 orange, 4 rouge, 5 noir ; « aucun massif traversé » vert ; le reste gris. */
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

/** Chasse : vert = pas de chasse ce jour-là, orange = jour de chasse ou de battue, gris = inconnu. Sans effet sur le verdict. */
export function huntingTileLevel(hunting?: HuntingInfo, outsideVar?: boolean): TileLevel {
  if (outsideVar || !hunting) return 'none';
  return hunting.tone === 'ok' ? 'ok' : hunting.tone === 'caution' ? 'warn' : 'none';
}
