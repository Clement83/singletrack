/** Map parameters that a return after sign-in may carry (#1591): view (#1577) and filters (`src/lib/tracks/filters.ts`). */
const MAP_PARAM = /^[a-zA-Z]{1,16}$/;

/**
 * Return after sign-in: the page of a guest link `/i/<token>` (#1434) or the map `/` with its view (#1591, `?t=&z=&lat=&lng=`),
 * never a free URL (no open redirect).
 */
export function safeNext(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1000) return undefined;
  if (/^\/i\/[A-Za-z0-9_-]{20,100}$/.test(value)) return value;
  if (value !== '/' && !value.startsWith('/?')) return undefined;
  const params = new URLSearchParams(value.slice(2));
  for (const k of params.keys()) if (!MAP_PARAM.test(k)) return undefined;
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}
