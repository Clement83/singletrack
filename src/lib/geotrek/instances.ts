import { SPORT_NATURE_VAR, slugify, type GeotrekInstance } from './geotrek';

/**
 * Public Geotrek instances with a mountain-bike practice (#1428), checked on 2026-11-13 by calling
 * `<apiBase>/trek_practice/` then `trek/?practices=<n>` directly (open API v2, no key). Adding an instance =
 * one entry here (stable id: prefix of `external_id`), nothing else. Each entry carries its own attribution.
 * Licences are **not** declared by the API: `license` stays empty, to be confirmed with each
 * manager before any reuse beyond display with attribution.
 *
 * Tried without success (no reachable public API v2): national parks of the Cévennes, Mercantour,
 * Vanoise; regional parks of Vercors, Chartreuse, Luberon, Verdon… (guessed hosts, none answers). The list
 * is to be completed on request (one ticket per manager, or the agent reads their "Open data" page).
 */
export const ECRINS: GeotrekInstance = {
  id: 'ecrins',
  apiBase: 'https://geotrek-admin.ecrins-parcnational.fr/api/v2',
  practices: [2], // "VTT" (id 2; 93 routes on 2026-11-13)
  ficheUrl: (t) => `https://rando.ecrins-parcnational.fr/fr/trek/${t.id}-${slugify(t.name)}`,
  attribution: 'Source : Parc national des Écrins – rando.ecrins-parcnational.fr',
  license: null,
  author: 'Parc national des Écrins',
};

export const GEOTREK_INSTANCES: readonly GeotrekInstance[] = [SPORT_NATURE_VAR, ECRINS];

/** Instances requested on the command line (ids, `all`); all of them without arguments. */
export function parseInstances(args: string[]): { instances: GeotrekInstance[]; invalid: string[] } {
  const wanted = args.flatMap((a) => a.split(',')).filter((a) => a && a !== '--');
  if (wanted.length === 0 || wanted.includes('all')) return { instances: [...GEOTREK_INSTANCES], invalid: [] };
  const instances = GEOTREK_INSTANCES.filter((i) => wanted.includes(i.id));
  return { instances: [...instances], invalid: wanted.filter((w) => !GEOTREK_INSTANCES.some((i) => i.id === w)) };
}
