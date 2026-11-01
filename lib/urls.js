const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'spm',
]);

function isTrackingParam(name) {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

export function parseHttpUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Same page by URL syntax alone: only differences the URL standard treats as equal. */
export function exactKey(raw) {
  try {
    const { href } = new URL(raw);
    return href.endsWith('#') ? href.slice(0, -1) : href;
  } catch {
    return raw;
  }
}

/**
 * Probably the same page: also ignores http vs https, www, trailing slashes,
 * tracking parameters and query order. Fragments are kept because single-page
 * apps route with them (`#/settings` and `#/inbox` are different pages).
 */
export function looseKey(raw) {
  const url = parseHttpUrl(raw);
  if (!url) return exactKey(raw);
  const host = url.hostname.replace(/^www\./, '');
  const port = url.port ? `:${url.port}` : '';
  const path = url.pathname.replace(/\/+$/, '');
  const params = [...url.searchParams]
    .filter(([name]) => !isTrackingParam(name))
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  const query = params.length ? `?${new URLSearchParams(params)}` : '';
  return `${host}${port}${path}${query}${url.hash}`;
}

/**
 * Hosts that only resolve on a local or company network. Probing them would
 * report them dead whenever you're off that network, and can trigger Chrome's
 * local network access prompt.
 */
export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  if (!host.includes('.') && !host.includes(':')) return true;
  if (/\.(localhost|local|internal|intranet|lan|corp|home\.arpa)$/.test(host)) return true;
  if (/^\[(::1|f[cd][0-9a-f]*:|fe[89ab][0-9a-f]*:)/.test(host)) return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Turns what someone typed into a URL, assuming https when no scheme was given. */
export function normalizeInputUrl(input) {
  const text = input.trim();
  if (!text) return null;
  // "localhost:3000" also parses as scheme "localhost", so a colon followed by
  // a digit counts as a port rather than a scheme.
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text);
  try {
    return new URL(hasScheme ? text : `https://${text}`).href;
  } catch {
    return null;
  }
}
