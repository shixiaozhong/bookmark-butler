// Answers address bar searches and runs the dead-link scan. The scan has to outlive
// the popup, which closes as soon as it loses focus, so all progress lives in
// chrome.storage and the popup follows along through storage.onChanged.
import { indexTree } from './lib/bookmarks-model.js';
import { initI18n, LANGUAGE_KEY, t } from './lib/i18n.js';
import { applyBatch, checkUrl, createJob, Kind, pickBatch } from './lib/link-check.js';
import { buildSuggestions, resolveEntered } from './lib/omnibox.js';

const JOB_KEY = 'linkCheckJob';
const RESUME_ALARM = 'link-check-resume';

async function getJob() {
  const { [JOB_KEY]: job = null } = await chrome.storage.local.get(JOB_KEY);
  return job;
}

// Serializes read-modify-write updates so Stop can't be overwritten by a batch finishing.
let updates = Promise.resolve();
function updateJob(change) {
  const run = updates.then(async () => {
    const next = await change(await getJob());
    if (next) await chrome.storage.local.set({ [JOB_KEY]: next });
    return next;
  });
  updates = run.catch(() => {});
  return run;
}

async function updateBadge(job) {
  let text = '';
  if (job?.status === 'running') {
    text = `${job.total ? Math.floor((job.checked / job.total) * 100) : 0}%`;
    await chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  } else if (job?.status === 'done') {
    const count = job.results.filter((r) => r.kind !== Kind.UNCERTAIN).length;
    text = count ? String(count) : '';
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  }
  await chrome.action.setBadgeText({ text });
}

async function runScan() {
  for (;;) {
    const job = await getJob();
    if (job?.status !== 'running') return;

    const batch = pickBatch(job.pending);
    const outcomes = await Promise.all(
      batch.map(async (entry) => ({ entry, result: await checkUrl(entry.url) })),
    );

    const next = await updateJob((current) => {
      if (current?.id !== job.id || current.status !== 'running') return null;
      // Going offline would make every remaining link look unreachable, so this
      // batch is discarded and stays queued for when the scan is resumed.
      if (!navigator.onLine) return { ...current, status: 'stopped', stopReason: 'offline' };
      return applyBatch(current, outcomes);
    });
    if (next) await updateBadge(next);
    if (next && next.status !== 'running') await chrome.alarms.clear(RESUME_ALARM);
  }
}

// Only guards against two loops in one worker lifetime. It's meant to reset when
// the worker is terminated: the alarm then wakes a new worker that picks up the
// queue from storage, re-checking at most the batch that was in flight.
let scan = null;
function ensureScanRunning() {
  scan ??= runScan()
    .catch((error) => console.error('Link scan failed', error))
    .finally(() => {
      scan = null;
    });
  return scan;
}

async function startScan() {
  const bookmarks = indexTree(await chrome.bookmarks.getTree()).bookmarks;
  const job = await updateJob(() => createJob(bookmarks));
  await updateBadge(job);
  if (job.status === 'running') {
    await chrome.alarms.create(RESUME_ALARM, { periodInMinutes: 0.5 });
    ensureScanRunning();
  }
}

async function stopScan() {
  const job = await updateJob((current) =>
    current?.status === 'running' ? { ...current, status: 'stopped', stopReason: 'user' } : null,
  );
  await chrome.alarms.clear(RESUME_ALARM);
  if (job) await updateBadge(job);
}

async function resumeScan() {
  const job = await updateJob((current) =>
    current?.status === 'stopped' ? { ...current, status: 'running', stopReason: null } : null,
  );
  if (!job) return;
  await updateBadge(job);
  await chrome.alarms.create(RESUME_ALARM, { periodInMinutes: 0.5 });
  ensureScanRunning();
}

/** After a browser restart or extension reload, carry on with an unfinished scan. */
async function continueInterruptedScan() {
  const job = await getJob();
  if (job?.status !== 'running') return;
  await chrome.alarms.create(RESUME_ALARM, { periodInMinutes: 0.5 });
  ensureScanRunning();
}

const handlers = {
  'link-check:start': startScan,
  'link-check:stop': stopScan,
  'link-check:resume': resumeScan,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  (async () => {
    try {
      await handler();
      sendResponse({ ok: true });
    } catch (error) {
      console.error(message.type, error);
      sendResponse({ ok: false, error: String(error?.message ?? error) });
    }
  })();
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RESUME_ALARM) ensureScanRunning();
});
chrome.runtime.onStartup.addListener(continueInterruptedScan);
chrome.runtime.onInstalled.addListener(continueInterruptedScan);

/* Address bar: type "b", then a space, then what you're looking for. */

async function allBookmarks() {
  return indexTree(await chrome.bookmarks.getTree()).bookmarks;
}

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  try {
    suggest(buildSuggestions(await allBookmarks(), text));
  } catch (error) {
    console.error('Bookmark suggestions failed', error);
  }
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  try {
    const url = resolveEntered(await allBookmarks(), text);
    if (disposition === 'currentTab') await chrome.tabs.update({ url });
    else await chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
  } catch (error) {
    console.error('Could not open bookmark', error);
  }
});

/* Language: the only text shown from here, besides the name the manifest gives Chrome. */

async function applyLanguage() {
  await initI18n();
  chrome.omnibox.setDefaultSuggestion({ description: t('omnibox_default') });
  await chrome.action.setTitle({ title: t('extension_name') });
}

applyLanguage();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[LANGUAGE_KEY]) applyLanguage();
});
