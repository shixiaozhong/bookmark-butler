import { findEmptyFolders } from '../lib/bookmarks-model.js';
import { findDuplicates } from '../lib/duplicates.js';
import { Kind } from '../lib/link-check.js';
import { checkRow, h, icon } from './dom.js';

const JOB_KEY = 'linkCheckJob';

const DEAD_GROUPS = [
  {
    kind: Kind.DEAD,
    title: '已失效',
    note: '服务器明确返回页面不存在。',
  },
  {
    kind: Kind.UNREACHABLE,
    title: '无法连接',
    note: '可能是域名或服务器已下线，也可能只是当前网络或代理访问不了，建议先确认。',
  },
  {
    kind: Kind.UNCERTAIN,
    title: '不确定',
    note: '站点拒绝了检测或响应超时，页面不一定失效，建议先打开看看。',
  },
];

function describeResult(result) {
  if (result.reason === 'timeout') return '响应超时';
  if (result.reason === 'network') return '无法连接';
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
    countLabel.textContent = `已选 ${selection.size} 项`;
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
      body.replaceChildren(h('p', { class: 'empty' }, '没有发现重复书签'));
      return;
    }
    const sections = groups.map((group) =>
      h(
        'section',
        { class: 'group' },
        h(
          'div',
          { class: 'group-header' },
          h('h3', {}, group.exact ? '完全相同' : '网址相似'),
          h('span', { class: 'spacer' }),
          h('span', { class: 'meta' }, `${group.items.length} 个`),
        ),
        group.items.map((item, position) =>
          checkRow({
            url: item.url,
            title: item.title,
            meta: `${item.path} · ${item.url}`,
            tag: position === 0 ? '最早' : null,
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
        `发现 ${groups.length} 组。已默认勾选完全相同的副本，每组保留最早收藏的一条；网址相似的不会默认勾选。`,
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
      body.replaceChildren(h('p', { class: 'empty' }, '没有发现空文件夹'));
      return;
    }
    body.replaceChildren(
      h('p', { class: 'hint' }, `发现 ${folders.length} 个文件夹，里面没有任何书签。如果有想留着备用的，取消勾选就好。`),
      h(
        'section',
        { class: 'group' },
        folders.map((folder) =>
          checkRow({
            title: folder.title,
            meta: folder.subfolders ? `${folder.path} · 含 ${folder.subfolders} 个空的子文件夹` : folder.path,
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
      if (!response?.ok) throw new Error(response?.error ?? '后台没有响应');
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
    const when = new Date(job.finishedAt).toLocaleString('zh-CN');
    const skipped = job.skipped ? `，跳过 ${job.skipped} 个内网或非网页地址` : '';
    const found = results.length ? `发现 ${results.length} 个问题` : '没有发现问题';
    return `${when} 检测了 ${job.total} 个网址${skipped}，${found}。`;
  }

  function scanCard(results) {
    if (!job) {
      return h(
        'div',
        { class: 'scan-card' },
        h('p', {}, '逐个访问书签网址，找出打不开的链接。检测在后台进行，关闭弹窗也不会中断，不会带上你的登录状态。'),
        h('div', { class: 'scan-actions' }, scanButton('开始检测', 'link-check:start', true)),
      );
    }
    if (job.status === 'running') {
      const progress = h('progress', { class: 'scan-progress', max: job.total, value: job.checked, 'aria-label': '检测进度' });
      const text = h('p', { role: 'status' });
      progressEls = { progress, text };
      updateProgress();
      return h(
        'div',
        { class: 'scan-card' },
        progress,
        text,
        h('div', { class: 'scan-actions' }, scanButton('停止', 'link-check:stop')),
      );
    }
    if (job.status === 'stopped') {
      const reason = job.stopReason === 'offline' ? '网络已断开，检测已暂停。' : '检测已停止。';
      return h(
        'div',
        { class: 'scan-card' },
        h('p', { role: 'status' }, `${reason}已完成 ${job.checked} / ${job.total}。`),
        h('div', { class: 'scan-actions' }, scanButton('继续', 'link-check:resume', true), scanButton('重新开始', 'link-check:start')),
      );
    }
    return h(
      'div',
      { class: 'scan-card' },
      h('p', { role: 'status' }, describeFinishedScan(results)),
      h('div', { class: 'scan-actions' }, scanButton('重新检测', 'link-check:start')),
    );
  }

  function updateProgress() {
    if (!progressEls || job?.status !== 'running') return;
    progressEls.progress.value = job.checked;
    progressEls.text.textContent = `正在检测 ${job.checked} / ${job.total}，可以关闭弹窗`;
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
          title: '在后台打开确认',
          'aria-label': `在后台打开“${result.title || result.url}”`,
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
      selectAll.textContent = allSelected() ? '取消全选' : '全选';
    };
    updateLabel();
    return h(
      'section',
      { class: 'group' },
      h(
        'div',
        { class: 'group-header' },
        h('h3', {}, `${title}（${members.length}）`),
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
      ...DEAD_GROUPS.map((group) => deadGroup(group, results, visibleIds)).filter(Boolean),
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
        title: '删除所选文件夹？',
        message: `将删除 ${ids.length} 个空文件夹。`,
      });
      if (removed) selection.clear();
      return;
    }

    let message = `将删除 ${ids.length} 个书签。`;
    if (mode === 'duplicates') {
      const wiped = findDuplicates(app.index.bookmarks).filter((group) =>
        group.items.every((item) => selection.has(item.id)),
      ).length;
      if (wiped) message += `其中 ${wiped} 组的所有副本都被勾选，这些书签一条都不会保留。`;
    }
    const removed = await app.removeNodes(ids, { title: '删除所选书签？', message });
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
