import type { OutingRow } from '@/db/schema';

export const LEVEL_LABEL: Record<OutingRow['level'], string> = { balade: 'Balade', sportif: 'Sportif', enduro: 'Enduro' };
export const EBIKE_LABEL: Record<OutingRow['ebike'], string> = { yes: 'VAE accepté', no: 'Sans VAE', only: 'VAE uniquement' };
export const STATUS_LABEL: Record<OutingRow['status'], string> = { planned: 'Prévue', cancelled: 'Annulée', done: 'Terminée' };

/** Itinéraire vers le RDV (ouvre l'appli de cartes du téléphone). */
export const directionsUrl = (lat: number, lon: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
