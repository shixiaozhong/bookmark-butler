import { canHoldChildren, canModify, indexTree } from '../lib/bookmarks-model.js';
import { parseHttpUrl } from '../lib/urls.js';
import { discardUndo, getUndoSnapshot, openUrl, removeWithUndo, undoRemove } from './actions.js';
import { createBookmarksView } from './bookmarks-view.js';
import { createCleanupView } from './cleanup-view.js';
import { confirmDialog, createBookmarkDialog, createFolderDialog, editNodeDialog, initEditDialog } from './dialogs.js';

const UI_KEY = 'uiState';

const app = {
  roots: [],
  index: { bookmarks: [], nodes: new Map() },
  folderId: null,
  view: 'bookmarks',

  openUrl,

  /** Runs a user action, reporting failures in the notice bar instead of losing them. */
  async run(action) {
    try {
      return await action();
    } catch (error) {
      console.error(error);
      showNotice(`操作失败：${error.message}`);
      return undefined;
    }
  },

  setFolder(id) {
    app.folderId = id;
    saveUiState();
  },

  notify(text) {
    showNotice(text);
  },

  async removeNode(node) {
    if (node.url !== undefined) {
      await app.run(() => removeAndOfferUndo([node.id]));
      return;
    }
    const count = app.index.nodes.get(node.id)?.count ?? 0;
    await app.removeNodes([node.id], {
      title: `删除文件夹“${node.title}”？`,
      message: count ? `里面的 ${count} 个书签也会一起删除。` : '这个文件夹是空的。',
    });
  },

  /** Confirms, then deletes. Resolves to whether anything was deleted. */
  async removeNodes(ids, { title, message }) {
    const confirmed = await confirmDialog({
      title,
      message: `${message}删除后 10 分钟内可以撤销。`,
      confirmLabel: '删除',
    });
    if (!confirmed) return false;
    await removeAndOfferUndo(ids);
    return true;
  },
};

const bookmarksView = createBookmarksView(app);
const cleanupView = createCleanupView(app);

function saveUiState() {
  chrome.storage.local.set({ [UI_KEY]: { view: app.view, folderId: app.folderId } });
}

/* Notice bar */

const notice = document.getElementById('notice');
const noticeText = document.getElementById('notice-text');
const noticeAction = document.getElementById('notice-action');
let noticeActionHandler = null;
let noticeCloseHandler = null;
let noticeTimer = null;

function hideNotice() {
  clearTimeout(noticeTimer);
  notice.hidden = true;
  noticeActionHandler = null;
  noticeCloseHandler = null;
}

function showNotice(text, { actionLabel = null, onAction = null, onClose = null } = {}) {
  clearTimeout(noticeTimer);
  noticeText.textContent = text;
  noticeAction.textContent = actionLabel ?? '';
  noticeAction.hidden = !actionLabel;
  noticeActionHandler = onAction;
  noticeCloseHandler = onClose;
  notice.hidden = false;
  // A notice offering an action stays put, since hiding it would take the action away.
  if (!actionLabel) noticeTimer = setTimeout(hideNotice, 5000);
}

noticeAction.addEventListener('click', () => {
  const handler = noticeActionHandler;
  hideNotice();
  app.run(handler);
});

document.getElementById('notice-close').addEventListener('click', () => {
  const handler = noticeCloseHandler;
  hideNotice();
  if (handler) app.run(handler);
});

function offerUndo(count) {
  showNotice(`已删除 ${count} 项`, {
    actionLabel: '撤销',
    onAction: async () => {
      const restored = await undoRemove();
      showNotice(restored ? `已恢复 ${restored} 项` : '没有可恢复的内容');
    },
    onClose: discardUndo,
  });
}

async function removeAndOfferUndo(ids) {
  const { removed, failed } = await removeWithUndo(ids);
  if (failed) showNotice(`已删除 ${removed} 项，${failed} 项删除失败`);
  else offerUndo(removed);
}

/* Data */

async function refresh() {
  app.roots = await chrome.bookmarks.getTree();
  app.index = indexTree(app.roots);
  // The folder on screen may have been deleted from somewhere else.
  if (!app.index.nodes.has(app.folderId)) app.folderId = firstWritableFolderId();
  if (app.view === 'bookmarks') bookmarksView.render();
  else cleanupView.render();
}

// One bulk delete fires an event per bookmark, so wait for the burst to end.
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => app.run(refresh), 80);
}

for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered']) {
  chrome.bookmarks[event].addListener(scheduleRefresh);
}

/* Views */

function setView(view) {
  app.view = view;
  saveUiState();
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'true');
    else tab.removeAttribute('aria-current');
  }
  document.getElementById('bookmarks-panel').hidden = view !== 'bookmarks';
  document.getElementById('cleanup-panel').hidden = view !== 'cleanup';
  if (view === 'bookmarks') {
    bookmarksView.render();
    bookmarksView.focus();
  } else {
    cleanupView.render();
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => setView(tab.dataset.view));
}

/* Toolbar */

function firstWritableFolderId() {
  return app.roots[0]?.children?.find((folder) => !folder.unmodifiable)?.id;
}

/** New items go in the folder on screen, unless that's the root or a managed folder. */
function targetFolderId() {
  return canHoldChildren(app.index.nodes.get(app.folderId)) ? app.folderId : firstWritableFolderId();
}

async function addCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = tab?.url && parseHttpUrl(tab.url) ? tab.url : '';
  // A page that's already saved opens for editing rather than being saved twice.
  if (url) {
    const [existing] = await chrome.bookmarks.search({ url });
    const node = existing && app.index.nodes.get(existing.id);
    if (node && canModify(node)) {
      editNodeDialog({ roots: app.roots, node });
      return;
    }
  }
  createBookmarkDialog({
    roots: app.roots,
    parentId: targetFolderId(),
    name: url ? tab.title : '',
    url,
  });
}

// A file picker would close the popup and lose its work, so this gets a page of its own.
document.getElementById('open-transfer').addEventListener('click', () => {
  app.run(() => openUrl(chrome.runtime.getURL('transfer/transfer.html')));
});

document.getElementById('add-page').addEventListener('click', () => app.run(addCurrentPage));
document.getElementById('add-folder').addEventListener('click', () => {
  createFolderDialog({ roots: app.roots, parentId: targetFolderId() });
});

/* Startup */

async function init() {
  initEditDialog();
  app.roots = await chrome.bookmarks.getTree();
  app.index = indexTree(app.roots);

  const { [UI_KEY]: ui } = await chrome.storage.local.get(UI_KEY);
  // Reopens where you left off, or at the bookmarks bar the first time.
  app.folderId = app.index.nodes.has(ui?.folderId) ? ui.folderId : firstWritableFolderId();

  await cleanupView.load();
  setView(ui?.view === 'cleanup' ? 'cleanup' : 'bookmarks');

  const snapshot = await getUndoSnapshot();
  if (snapshot) offerUndo(snapshot.items.length);
}

app.run(init);
