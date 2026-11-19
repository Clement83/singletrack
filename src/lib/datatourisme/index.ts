export * from './limiter';
export * from './client';
export * from './tours';
export * from './dedup';
export * from './sync';

/** API key from the environment (never logged). Absent = the DATAtourisme sync is off. */
export function datatourismeApiKey(): string | null {
  return process.env.DATA_TOURISM_API_KEY?.trim() || null;
}
