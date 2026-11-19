import { RequestLimiter } from './limiter';

/** DATAtourisme REST API (#1643): https://api.datatourisme.fr/v1/docs */
export const DATATOURISME_API = 'https://api.datatourisme.fr/v1';

/** Our own limits, well below the published quotas (1,000 req/h, ~10 req/s, 20–30 concurrent). */
export const API_LIMITS = { minIntervalMs: 6_000, maxPerHour: 500 } as const;
/** Trace files (GPX/KML) live on the producers' media servers: one at a time, 2 s apart, 5 MB max. */
export const FILE_LIMITS = { minIntervalMs: 2_000, maxPerHour: 1_500, maxBytes: 5 * 1024 * 1024, timeoutMs: 30_000 } as const;
export const MAX_ATTEMPTS = 4;

const USER_AGENT = 'singletrack (+https://github.com/Clement83/singletrack)';

export type ClientOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  apiLimiter?: RequestLimiter;
  fileLimiter?: RequestLimiter;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (msg: string) => void;
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** Never log the key: drops an `api_key` query parameter if the API echoes one in its links. */
export function redact(url: string): string {
  return url.replace(/([?&])api_key=[^&]*/gi, '$1api_key=…');
}

/** Delay before retry `attempt` (1-based): `Retry-After` (seconds or HTTP date) wins, else exponential + jitter. */
export function retryDelayMs(attempt: number, retryAfter: string | null, random: () => number = Math.random, now = Date.now()): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 3_600_000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.max(0, Math.min(at - now, 3_600_000));
  }
  const base = 10_000 * 2 ** (attempt - 1);
  return Math.round(base + random() * base);
}

const retryable = (status: number) => status === 429 || status >= 500;

export class DatatourismeClient {
  readonly api: RequestLimiter;
  readonly files: RequestLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: ClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.api = opts.apiLimiter ?? new RequestLimiter({ ...API_LIMITS, sleep: this.sleep });
    this.files = opts.fileLimiter ?? new RequestLimiter({ ...FILE_LIMITS, sleep: this.sleep });
    this.random = opts.random ?? Math.random;
    this.log = opts.log ?? (() => {});
  }

  /** GET on the API (`/tour?…` or an absolute `next` link), JSON body, with limiter and retries. */
  async getJson<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : DATATOURISME_API + pathOrUrl;
    const res = await this.withRetries(this.api, url, () =>
      this.fetchImpl(url, { headers: { 'X-API-Key': this.opts.apiKey, Accept: 'application/json', 'User-Agent': USER_AGENT } }),
    );
    return (await res.json()) as T;
  }

  /** Downloads a trace file (no API key: it is a third-party URL), size-capped. */
  async getFile(url: string): Promise<Buffer> {
    const res = await this.withRetries(this.files, url, () =>
      this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FILE_LIMITS.timeoutMs) }),
    );
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > FILE_LIMITS.maxBytes) throw new Error(`file too large (${declared} bytes)`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > FILE_LIMITS.maxBytes) throw new Error(`file too large (${buf.length} bytes)`);
    return buf;
  }

  private async withRetries(limiter: RequestLimiter, url: string, call: () => Promise<Response>): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let res: Response | null = null;
      let error: unknown = null;
      try {
        res = await limiter.schedule(call);
      } catch (e) {
        error = e;
      }
      if (res?.ok) return res;
      const status = res?.status ?? 0;
      const canRetry = error !== null || retryable(status);
      if (!canRetry || attempt >= MAX_ATTEMPTS) {
        if (res) throw new HttpError(status, redact(url));
        throw error instanceof Error ? error : new Error(String(error));
      }
      const wait = retryDelayMs(attempt, res?.headers.get('retry-after') ?? null, this.random);
      this.log(`  … ${status || 'network error'} on ${redact(url)}, retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(wait / 1000)} s`);
      await this.sleep(wait);
    }
  }
}
