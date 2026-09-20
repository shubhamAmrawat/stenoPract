/**
 * Turns CLIENT_ORIGIN into a list of browser origins.
 * Accepts one URL or several separated by commas; a trailing slash or path is ignored ("https://a.com/" -> "https://a.com").
 */
export function parseOrigins(raw: string | undefined, fallback: string): string[] {
  const parts = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origins = (parts.length > 0 ? parts : [fallback]).map((part) => {
    let url: URL;
    try {
      url = new URL(part);
    } catch {
      throw new Error(`CLIENT_ORIGIN has an invalid URL: "${part}" (write it like https://app.example.com)`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`CLIENT_ORIGIN must start with http:// or https://, got "${part}"`);
    }
    return url.origin;
  });
  return [...new Set(origins)];
}

/**
 * How many reverse proxies sit in front of the API (Express "trust proxy").
 * Unset: 1 in production (Render, Railway and similar put one proxy in front), none locally.
 * A wrong number makes every visitor look like one IP (rate limits shared) or lets clients fake their IP.
 */
export function parseTrustProxy(raw: string | undefined, isProd: boolean): number | false {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return isProd ? 1 : false;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops === 0 ? false : hops;
  }
  throw new Error('TRUST_PROXY must be a number of proxies (for example 1 or 2) or "false"');
}
