import { SPORT_NATURE_VAR, slugify, type GeotrekInstance } from './geotrek';

/**
 * Instances Geotrek publiques avec une pratique VTT (#1428), vérifiées le 2026-11-13 par appel direct de
 * `<apiBase>/trek_practice/` puis `trek/?practices=<n>` (API v2 ouverte, sans clé). Ajouter une instance =
 * une entrée ici (id stable : préfixe de `external_id`), rien d'autre. Chaque entrée porte sa propre attribution.
 * Les licences ne sont **pas** déclarées par l'API : `license` reste vide, à confirmer auprès de chaque
 * gestionnaire avant toute réutilisation hors affichage avec attribution.
 *
 * Essayées sans succès (pas d'API v2 publique joignable) : parcs nationaux des Cévennes, du Mercantour, de la
 * Vanoise ; PNR du Vercors, de la Chartreuse, du Luberon, du Verdon… (hôtes devinés, aucun ne répond). La liste
 * est à compléter au fil des demandes (un ticket par gestionnaire, ou l'agent lit leur page « Open data »).
 */
export const ECRINS: GeotrekInstance = {
  id: 'ecrins',
  apiBase: 'https://geotrek-admin.ecrins-parcnational.fr/api/v2',
  practices: [2], // « VTT » (id 2 ; 93 itinéraires au 2026-11-13)
  ficheUrl: (t) => `https://rando.ecrins-parcnational.fr/fr/trek/${t.id}-${slugify(t.name)}`,
  attribution: 'Source : Parc national des Écrins – rando.ecrins-parcnational.fr',
  license: null,
  author: 'Parc national des Écrins',
};

export const GEOTREK_INSTANCES: readonly GeotrekInstance[] = [SPORT_NATURE_VAR, ECRINS];

/** Instances demandées en ligne de commande (ids, `all`) ; toutes sans argument. */
export function parseInstances(args: string[]): { instances: GeotrekInstance[]; invalid: string[] } {
  const wanted = args.flatMap((a) => a.split(',')).filter((a) => a && a !== '--');
  if (wanted.length === 0 || wanted.includes('all')) return { instances: [...GEOTREK_INSTANCES], invalid: [] };
  const instances = GEOTREK_INSTANCES.filter((i) => wanted.includes(i.id));
  return { instances: [...instances], invalid: wanted.filter((w) => !GEOTREK_INSTANCES.some((i) => i.id === w)) };
}
