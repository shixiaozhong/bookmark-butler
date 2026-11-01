import { findEmptyFolders } from '../lib/bookmarks-model.js';
import { findDuplicates } from '../lib/duplicates.js';
import { plural, t, textLocale } from '../lib/i18n.js';
import { Kind } from '../lib/link-check.js';
import { checkRow, h, icon } from './dom.js';

const JOB_KEY = 'linkCheckJob';

const deadGroups = () => [
  {
    kind: Kind.DEAD,
    title: t('dead_title'),
    note: t('dead_note'),
  },
  {
    kind: Kind.UNREACHABLE,
    title: t('unreachable_title'),
    note: t('unreachable_note'),
  },
  {
    kind: Kind.UNCERTAIN,
    title: t('uncertain_title'),
    note: t('uncertain_note'),
  },
];

function describeResult(result) {
  if (result.reason === 'timeout') return t('reason_timeout');
  if (result.reason === 'network') return t('unreachable_title');
  return `HTTP ${result.status}`;
}

export function createCleanupView(app) {
  const body = document.getElementById('cleanup-body');
  const footer = document.getElementById('cleanup-footer');
  const countLabel = document.getElementById('cleanup-count');
  const deleteButton = document.getElementById('cleanup-delete');

  let mode = 'duplicates';
  let job = null;
  // Selections outlive re-renders. Each duplicate only gets its default the first
  // time it's seen, so what you unticked stays unticked as the list refreshes.
  const duplicateSelection = new Set();
  const seenDuplicates = new Set();
  const deadSelection = new Set();
  const emptySelection = new Set();
  const seenEmpty = new Set();
  // The scan writes progress constantly; the list rebuilds only when its content changes.
  let renderedDeadList = null;
  let progressEls = null;

  const activeSelection = () =>
    ({ duplicates: duplicateSelection, dead: deadSelection, empty: emptySelection })[mode];

  function updateFooter(visibleIds) {
    const selection = activeSelection();
    for (const id of selection) {
      if (!visibleIds.has(id)) selection.delete(id);
    }
    footer.hidden = visibleIds.size === 0;
    countLabel.textContent = t('selected_count', selection.size);
    deleteButton.disabled = selection.size === 0;
  }

  /* Duplicates */

  function currentDuplicateGroups() {
    const groups = findDuplicates(app.index.bookmarks);
    for (const group of groups) {
      for (const item of group.items) {
        if (seenDuplicates.has(item.id)) continue;
        seenDuplicates.add(item.id);
        if (group.removable.includes(item.id)) duplicateSelection.add(item.id);
      }
    }
    return groups;
  }

  function renderDuplicates() {
    const groups = currentDuplicateGroups();
    const visibleIds = new Set(groups.flatMap((group) => group.items.map((item) => item.id)));
    updateFooter(visibleIds);
    if (!groups.length) {
      body.replaceChildren(h('p', { class: 'empty' }, t('no_duplicates')));
      return;
    }
    const sections = groups.map((group) =>
      h(
        'section',
        { class: 'group' },
        h(
          'div',
          { class: 'group-header' },
          h('h3', {}, group.exact ? t('duplicates_identical') : t('duplicates_similar')),
          h('span', { class: 'spacer' }),
          h('span', { class: 'meta' }, t('duplicates_copies', group.items.length)),
        ),
        group.items.map((item, position) =>
          checkRow({
            url: item.url,
            title: item.title,
            meta: `${item.path} · ${item.url}`,
            tag: position === 0 ? t('duplicates_oldest') : null,
            checked: duplicateSelection.has(item.id),
            onChange: (checked) => {
              if (checked) duplicateSelection.add(item.id);
              else duplicateSelection.delete(item.id);
              updateFooter(visibleIds);
            },
          }),
        ),
      ),
    );
    body.replaceChildren(
      h(
        'p',
        { class: 'hint' },
        plural('duplicates_summary', groups.length),
      ),
      ...sections,
    );
  }

  /* Empty folders */

  function renderEmptyFolders() {
    const folders = findEmptyFolders(app.index.nodes);
    for (const { id } of folders) {
      if (seenEmpty.has(id)) continue;
      seenEmpty.add(id);
      emptySelection.add(id);
    }
    const visibleIds = new Set(folders.map((folder) => folder.id));
    updateFooter(visibleIds);
    if (!folders.length) {
      body.replaceChildren(h('p', { class: 'empty' }, t('no_empty_folders')));
      return;
    }
    body.replaceChildren(
      h('p', { class: 'hint' }, plural('empty_summary', folders.length)),
      h(
        'section',
        { class: 'group' },
        folders.map((folder) =>
          checkRow({
            title: folder.title,
            meta: folder.subfolders ? plural('empty_subfolders', folder.subfolders, folder.path) : folder.path,
            leading: icon('folder', 'folder-icon'),
            checked: emptySelection.has(folder.id),
            onChange: (checked) => {
              if (checked) emptySelection.add(folder.id);
              else emptySelection.delete(folder.id);
              updateFooter(visibleIds);
            },
          }),
        ),
      ),
    );
  }

  /* Dead links */

  function liveResults() {
    // Results can outlast the bookmarks they describe, so check them against the current tree.
    return (job?.results ?? []).filter((result) => app.index.nodes.get(result.id)?.url === result.url);
  }

  function sendScanCommand(type) {
    app.run(async () => {
      const response = await chrome.runtime.sendMessage({ type });
      if (!response?.ok) throw new Error(response?.error ?? t('no_response'));
    });
  }

  function scanButton(label, type, primary = false) {
    return h(
      'button',
      { type: 'button', class: `button${primary ? ' primary' : ''}`, onclick: () => sendScanCommand(type) },
      label,
    );
  }

  function describeFinishedScan(results) {
    const when = new Date(job.finishedAt).toLocaleString(textLocale());
    const skipped = job.skipped ? plural('scan_skipped', job.skipped) : '';
    const found = results.length ? plural('scan_found', results.length) : t('scan_clean');
    return `${plural('scan_checked', job.total, when)}${skipped}${found}`;
  }

  function scanCard(results) {
    if (!job) {
      return h(
        'div',
        { class: 'scan-card' },
        h('p', {}, t('scan_intro')),
        h('div', { class: 'scan-actions' }, scanButton(t('scan_start'), 'link-check:start', true)),
      );
    }
    if (job.status === 'running') {
      const progress = h('progress', { class: 'scan-progress', max: job.total, value: job.checked, 'aria-label': t('scan_progress') });
      const text = h('p', { role: 'status' });
      progressEls = { progress, text };
      updateProgress();
      return h(
        'div',
        { class: 'scan-card' },
        progress,
        text,
        h('div', { class: 'scan-actions' }, scanButton(t('scan_stop'), 'link-check:stop')),
      );
    }
    if (job.status === 'stopped') {
      const reason = job.stopReason === 'offline' ? t('scan_offline') : t('scan_stopped');
      return h(
        'div',
        { class: 'scan-card' },
        h('p', { role: 'status' }, t('scan_stopped_progress', job.checked, job.total, reason)),
        h('div', { class: 'scan-actions' }, scanButton(t('scan_resume'), 'link-check:resume', true), scanButton(t('scan_restart'), 'link-check:start')),
      );
    }
    return h(
      'div',
      { class: 'scan-card' },
      h('p', { role: 'status' }, describeFinishedScan(results)),
      h('div', { class: 'scan-actions' }, scanButton(t('scan_recheck'), 'link-check:start')),
    );
  }

  function updateProgress() {
    if (!progressEls || job?.status !== 'running') return;
    progressEls.progress.value = job.checked;
    progressEls.text.textContent = t('scan_running', job.checked, job.total);
  }

  function deadRow(result, visibleIds, onToggle) {
    const row = checkRow({
      url: result.url,
      title: result.title,
      meta: `${describeResult(result)} · ${result.url}`,
      checked: deadSelection.has(result.id),
      onChange: (checked) => {
        if (checked) deadSelection.add(result.id);
        else deadSelection.delete(result.id);
        updateFooter(visibleIds);
        onToggle();
      },
    });
    row.append(
      h(
        'button',
        {
          type: 'button',
          class: 'icon-button small',
          title: t('open_to_check'),
          'aria-label': t('open_item_background', result.title || result.url),
          onclick: (event) => {
            event.preventDefault();
            app.run(() => app.openUrl(result.url, { active: false }));
          },
        },
        icon('external'),
      ),
    );
    return row;
  }

  function deadGroup({ kind, title, note }, results, visibleIds) {
    const members = results.filter((result) => result.kind === kind);
    if (!members.length) return null;
    const allSelected = () => members.every((result) => deadSelection.has(result.id));
    const selectAll = h(
      'button',
      {
        type: 'button',
        class: 'link-button',
        onclick: () => {
          const clearing = allSelected();
          for (const result of members) {
            if (clearing) deadSelection.delete(result.id);
            else deadSelection.add(result.id);
          }
          renderDead({ force: true });
        },
      },
    );
    const updateLabel = () => {
      selectAll.textContent = allSelected() ? t('deselect_all') : t('select_all');
    };
    updateLabel();
    return h(
      'section',
      { class: 'group' },
      h(
        'div',
        { class: 'group-header' },
        h('h3', {}, t('group_title', title, members.length)),
        h('span', { class: 'spacer' }),
        selectAll,
      ),
      h('p', { class: 'group-note' }, note),
      members.map((result) => deadRow(result, visibleIds, updateLabel)),
    );
  }

  function renderDead({ force = false } = {}) {
    const results = liveResults();
    const signature = [job?.id, job?.status, results.length].join('|');
    if (!force && renderedDeadList === signature) {
      updateProgress();
      return;
    }
    renderedDeadList = signature;
    progressEls = null;

    const visibleIds = new Set(results.map((result) => result.id));
    updateFooter(visibleIds);
    const { scrollTop } = body;
    body.replaceChildren(
      scanCard(results),
      ...deadGroups().map((group) => deadGroup(group, results, visibleIds)).filter(Boolean),
    );
    body.scrollTop = scrollTop;

    if (job?.status === 'done') chrome.action.setBadgeText({ text: '' });
  }

  /* Shared */

  function render() {
    for (const button of document.querySelectorAll('.segment')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
    if (mode === 'duplicates') renderDuplicates();
    else if (mode === 'empty') renderEmptyFolders();
    else renderDead({ force: true });
  }

  async function deleteSelected() {
    const selection = activeSelection();
    const ids = [...selection];
    if (!ids.length) return;

    if (mode === 'empty') {
      const removed = await app.removeNodes(ids, {
        title: t('delete_folders_title'),
        message: plural('delete_empty_folders', ids.length),
      });
      if (removed) selection.clear();
      return;
    }

    let message = plural('delete_bookmarks', ids.length);
    if (mode === 'duplicates') {
      const wiped = findDuplicates(app.index.bookmarks).filter((group) =>
        group.items.every((item) => selection.has(item.id)),
      ).length;
      if (wiped) message += plural('delete_all_copies', wiped);
    }
    const removed = await app.removeNodes(ids, { title: t('delete_bookmarks_title'), message });
    if (removed) selection.clear();
  }

  for (const button of document.querySelectorAll('.segment')) {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      body.scrollTop = 0;
      render();
    });
  }
  deleteButton.addEventListener('click', () => app.run(deleteSelected));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[JOB_KEY]) return;
    job = changes[JOB_KEY].newValue ?? null;
    if (app.view === 'cleanup' && mode === 'dead') renderDead();
  });

  return {
    render,
    async load() {
      ({ [JOB_KEY]: job = null } = await chrome.storage.local.get(JOB_KEY));
    },
  };
}
