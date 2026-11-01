import { isPrivateHost, parseHttpUrl } from './urls.js';

export const Kind = Object.freeze({
  OK: 'ok',
  /** The server answered and said the page is gone. */
  DEAD: 'dead',
  /** No answer at all: a dead domain, or just this network or proxy. */
  UNREACHABLE: 'unreachable',
  /** The server refused or stalled, which says little about the page. */
  UNCERTAIN: 'uncertain',
});

const TIMEOUT_MS = 10_000;

function classifyStatus(status) {
  if (status === 404 || status === 410) return Kind.DEAD;
  return status >= 200 && status < 400 ? Kind.OK : Kind.UNCERTAIN;
}

async function probe(url, method, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('timed out', 'TimeoutError')),
    timeoutMs,
  );
  try {
    // credentials: 'omit' keeps checks from acting as your logged-in account.
    const response = await fetchImpl(url, {
      method,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.status;
  } finally {
    clearTimeout(timer);
    // Only the status matters, so don't download the body of a GET.
    controller.abort();
  }
}

function classifyError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError'
    ? { kind: Kind.UNCERTAIN, reason: 'timeout' }
    : { kind: Kind.UNREACHABLE, reason: 'network' };
}

/**
 * HEAD first because it's cheap, but servers often answer HEAD wrongly (405,
 * 403, even 404) or drop the connection, so anything other than success is
 * confirmed with a GET. A timeout isn't retried: it would only double the wait.
 */
export async function checkUrl(url, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const status = await probe(url, 'HEAD', fetchImpl, timeoutMs);
    if (classifyStatus(status) === Kind.OK) return { kind: Kind.OK, status };
  } catch (error) {
    const result = classifyError(error);
    if (result.reason === 'timeout') return result;
  }
  try {
    const status = await probe(url, 'GET', fetchImpl, timeoutMs);
    return { kind: classifyStatus(status), status, reason: 'http' };
  } catch (error) {
    return classifyError(error);
  }
}

/** Builds a scan from a bookmark list, checking each distinct URL once. */
export function createJob(bookmarks, id = crypto.randomUUID(), now = Date.now()) {
  const byUrl = new Map();
  let skipped = 0;
  for (const { id: bookmarkId, title, url } of bookmarks) {
    const parsed = parseHttpUrl(url);
    if (!parsed || isPrivateHost(parsed.hostname)) {
      skipped++;
      continue;
    }
    const entry = byUrl.get(url);
    if (entry) entry.bookmarks.push({ id: bookmarkId, title });
    else byUrl.set(url, { url, bookmarks: [{ id: bookmarkId, title }] });
  }
  const pending = [...byUrl.values()];
  return {
    id,
    status: pending.length ? 'running' : 'done',
    startedAt: now,
    finishedAt: pending.length ? null : now,
    stopReason: null,
    total: pending.length,
    checked: 0,
    skipped,
    pending,
    results: [],
  };
}

/** Picks the next URLs to probe, limiting each host so a big site doesn't rate-limit the scan. */
export function pickBatch(pending, { size = 8, perHost = 2 } = {}) {
  const batch = [];
  const perHostCount = new Map();
  for (const entry of pending) {
    if (batch.length >= size) break;
    const host = new URL(entry.url).hostname;
    const count = perHostCount.get(host) ?? 0;
    if (count >= perHost) continue;
    perHostCount.set(host, count + 1);
    batch.push(entry);
  }
  return batch;
}

/** Returns the job with a finished batch applied. `outcomes` is `[{ entry, result }]`. */
export function applyBatch(job, outcomes, now = Date.now()) {
  const finished = new Set(outcomes.map(({ entry }) => entry.url));
  const pending = job.pending.filter((entry) => !finished.has(entry.url));
  const results = [...job.results];
  for (const { entry, result } of outcomes) {
    if (result.kind === Kind.OK) continue;
    for (const { id, title } of entry.bookmarks) {
      results.push({ id, title, url: entry.url, kind: result.kind, status: result.status, reason: result.reason });
    }
  }
  const done = pending.length === 0;
  return {
    ...job,
    pending,
    results,
    checked: job.total - pending.length,
    status: done ? 'done' : job.status,
    finishedAt: done ? now : job.finishedAt,
  };
}
