import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBatch, checkUrl, createJob, Kind, pickBatch } from '../lib/link-check.js';

/** A fetch stub that answers from a `{ HEAD, GET }` table: a status code, or an error to throw. */
function stubFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, { method }) => {
    calls.push(method);
    const answer = answers[method];
    if (answer instanceof Error) throw answer;
    return { status: answer };
  };
  return { fetchImpl, calls };
}

const timeoutError = () => new DOMException('timed out', 'TimeoutError');

test('a successful HEAD needs no GET', async () => {
  const { fetchImpl, calls } = stubFetch({ HEAD: 200 });
  assert.equal((await checkUrl('https://a.com/', { fetchImpl })).kind, Kind.OK);
  assert.deepEqual(calls, ['HEAD']);
});

test('a failed HEAD is confirmed with GET, which decides the result', async () => {
  for (const [head, get, kind] of [
    [405, 200, Kind.OK],
    [404, 200, Kind.OK],
    [404, 404, Kind.DEAD],
    [405, 410, Kind.DEAD],
    [403, 403, Kind.UNCERTAIN],
    [500, 503, Kind.UNCERTAIN],
    [429, 429, Kind.UNCERTAIN],
    [new TypeError('reset'), 200, Kind.OK],
  ]) {
    const { fetchImpl } = stubFetch({ HEAD: head, GET: get });
    assert.equal((await checkUrl('https://a.com/', { fetchImpl })).kind, kind, `${head} then ${get}`);
  }
});

test('a network failure on both attempts counts as unreachable, not dead', async () => {
  const { fetchImpl } = stubFetch({ HEAD: new TypeError('dns'), GET: new TypeError('dns') });
  assert.deepEqual(await checkUrl('https://a.com/', { fetchImpl }), {
    kind: Kind.UNREACHABLE,
    reason: 'network',
  });
});

test('a timeout is uncertain and is not retried', async () => {
  const { fetchImpl, calls } = stubFetch({ HEAD: timeoutError() });
  assert.deepEqual(await checkUrl('https://a.com/', { fetchImpl }), {
    kind: Kind.UNCERTAIN,
    reason: 'timeout',
  });
  assert.deepEqual(calls, ['HEAD']);
});

test('a hung request is cut off by the timeout', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  const result = await checkUrl('https://a.com/', { fetchImpl, timeoutMs: 5 });
  assert.equal(result.reason, 'timeout');
});

test('requests never send cookies', async () => {
  let options;
  const fetchImpl = async (url, init) => {
    options = init;
    return { status: 200 };
  };
  await checkUrl('https://a.com/', { fetchImpl });
  assert.equal(options.credentials, 'omit');
});

test('createJob checks each URL once and skips what it cannot judge', () => {
  const job = createJob(
    [
      { id: '1', title: 'A', url: 'https://a.com/' },
      { id: '2', title: 'A again', url: 'https://a.com/' },
      { id: '3', title: 'NAS', url: 'http://192.168.1.2/' },
      { id: '4', title: 'Settings', url: 'chrome://settings' },
      { id: '5', title: 'Tool', url: 'javascript:void(0)' },
    ],
    'job',
    1000,
  );
  assert.equal(job.status, 'running');
  assert.equal(job.total, 1);
  assert.equal(job.skipped, 3);
  assert.deepEqual(job.pending[0].bookmarks.map((b) => b.id), ['1', '2']);
});

test('createJob finishes immediately when nothing can be checked', () => {
  const job = createJob([{ id: '1', title: 'NAS', url: 'http://nas.local/' }], 'job', 1000);
  assert.equal(job.status, 'done');
  assert.equal(job.finishedAt, 1000);
});

test('pickBatch limits both batch size and requests per host', () => {
  const entries = (host, n) => Array.from({ length: n }, (_, i) => ({ url: `https://${host}/${i}` }));
  const batch = pickBatch([...entries('a.com', 5), ...entries('b.com', 1)], { size: 8, perHost: 2 });
  assert.deepEqual(batch.map((e) => e.url), ['https://a.com/0', 'https://a.com/1', 'https://b.com/0']);
  assert.equal(pickBatch(entries('c.com', 1).concat(entries('d.com', 1)), { size: 1 }).length, 1);
});

test('applyBatch moves progress forward and records only problem links', () => {
  const job = createJob(
    [
      { id: '1', title: 'OK', url: 'https://ok.com/' },
      { id: '2', title: 'Gone', url: 'https://gone.com/' },
      { id: '3', title: 'Gone copy', url: 'https://gone.com/' },
      { id: '4', title: 'Later', url: 'https://later.com/' },
    ],
    'job',
    1000,
  );
  const [ok, gone, later] = job.pending;

  const partial = applyBatch(job, [
    { entry: ok, result: { kind: Kind.OK, status: 200 } },
    { entry: gone, result: { kind: Kind.DEAD, status: 404, reason: 'http' } },
  ]);
  assert.equal(partial.status, 'running');
  assert.equal(partial.checked, 2);
  assert.deepEqual(partial.results.map((r) => r.id), ['2', '3']);

  const finished = applyBatch(partial, [{ entry: later, result: { kind: Kind.OK, status: 200 } }], 2000);
  assert.equal(finished.status, 'done');
  assert.equal(finished.finishedAt, 2000);
  assert.equal(finished.checked, 3);
  assert.deepEqual(job.results, [], 'the original job is not mutated');
});
