import { canHoldChildren, canModify, indexTree } from '../lib/bookmarks-model.js';
import { AUTO, getLanguage, initI18n, LANGUAGES, localizeDocument, plural, setLanguage, t } from '../lib/i18n.js';
import { parseHttpUrl } from '../lib/urls.js';
import { discardUndo, getUndoSnapshot, openUrl, removeWithUndo, undoRemove } from './actions.js';
import { createBookmarksView } from './bookmarks-view.js';
import { createCleanupView } from './cleanup-view.js';
import { h } from './dom.js';
import { confirmDialog, createBookmarkDialog, createFolderDialog, editNodeDialog, initEditDialog, initEscapeKey, initShortcutHelp } from './dialogs.js';

await initI18n();
localizeDocument();

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
      showNotice(t('action_failed', error.message));
      return undefined;
    }
  },

  setFolder(id) {
    app.folderId = id;
    saveUiState();
  },

  notify(text, options) {
    showNotice(text, options);
  },

  async removeNode(node) {
    if (node.url !== undefined) {
      await app.run(() => removeAndOfferUndo([node.id]));
      return;
    }
    const count = app.index.nodes.get(node.id)?.count ?? 0;
    await app.removeNodes([node.id], {
      title: t('delete_folder_title', node.title),
      message: count ? plural('delete_folder_contents', count) : t('delete_folder_empty'),
    });
  },

  /** Confirms, then deletes. Resolves to whether anything was deleted. */
  async removeNodes(ids, { title, message }) {
    const confirmed = await confirmDialog({
      title,
      message: `${message}${t('undo_window')}`,
      confirmLabel: t('delete'),
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

function showNotice(text, { actionLabel = null, onAction = null, onClose = null, hideAfterMs = null } = {}) {
  clearTimeout(noticeTimer);
  noticeText.textContent = text;
  noticeAction.textContent = actionLabel ?? '';
  noticeAction.hidden = !actionLabel;
  noticeActionHandler = onAction;
  noticeCloseHandler = onClose;
  notice.hidden = false;
  // Without a time given, a notice offering an action stays: hiding it would take the action away.
  const delay = hideAfterMs ?? (actionLabel ? null : 5000);
  if (delay) noticeTimer = setTimeout(hideNotice, delay);
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
  showNotice(plural('deleted_count', count), {
    actionLabel: t('undo'),
    onAction: async () => {
      const restored = await undoRemove();
      showNotice(restored ? plural('restored_count', restored) : t('nothing_to_restore'));
    },
    onClose: discardUndo,
  });
}

async function removeAndOfferUndo(ids) {
  const { removed, failed } = await removeWithUndo(ids);
  if (failed) showNotice(t('delete_partial', removed, failed));
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

/* Language */

async function initLanguagePicker() {
  const picker = document.getElementById('language');
  picker.replaceChildren(
    h('option', { value: AUTO }, t('language_auto')),
    ...Object.entries(LANGUAGES).map(([code, name]) => h('option', { value: code }, name)),
  );
  picker.value = await getLanguage();
  picker.addEventListener('change', () => {
    // Text is everywhere and much of it is built as needed, so a reload is the reliable way to swap it.
    app.run(async () => {
      await setLanguage(picker.value);
      location.reload();
    });
  });
}

/* Startup */

async function init() {
  initEditDialog();
  initEscapeKey();
  await initLanguagePicker();
  initShortcutHelp();
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
