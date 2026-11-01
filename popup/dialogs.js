import { folderOptions } from '../lib/bookmarks-model.js';
import { isMacPlatform, opensShortcutHelp, shortcutGroups } from '../lib/shortcuts.js';
import { normalizeInputUrl } from '../lib/urls.js';
import { h } from './dom.js';

function shortcutKeys({ keys, inTurn }) {
  const parts = [];
  keys.forEach((key, position) => {
    if (position) parts.push(inTurn ? ' ' : ' + ');
    parts.push(h('kbd', {}, key));
  });
  return h('dt', {}, parts);
}

/**
 * Chrome closes a popup on any Esc press the page doesn't cancel, and a native
 * dialog closing itself doesn't count. So Esc is cancelled here and does its
 * job by hand, peeling back one layer at a time before the popup can close.
 */
export function initEscapeKey() {
  const search = document.getElementById('search');
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const dialog = document.querySelector('dialog[open]');
    if (dialog) {
      event.preventDefault();
      dialog.close();
    } else if (event.target === search && search.value) {
      event.preventDefault();
      search.value = '';
      search.dispatchEvent(new Event('input'));
    }
  });
}

/** Fills in the shortcut list once and wires up the ways of opening it. */
export function initShortcutHelp() {
  const dialog = document.getElementById('help-dialog');
  const search = document.getElementById('search');
  const platform = navigator.userAgentData?.platform ?? navigator.platform;

  document.getElementById('help-list').replaceChildren(
    ...shortcutGroups(isMacPlatform(platform)).map((group) =>
      h(
        'section',
        {},
        h('h3', {}, group.title),
        h('dl', {}, group.items.map((item) => h('div', {}, shortcutKeys(item), h('dd', {}, item.action)))),
      ),
    ),
  );

  document.getElementById('open-help').addEventListener('click', () => dialog.showModal());
  document.addEventListener('keydown', (event) => {
    const editing = event.target.matches?.('input:not([type="checkbox"]), select, textarea') ?? false;
    const opens = opensShortcutHelp(event, {
      editing,
      emptySearch: event.target === search && !search.value,
      dialogOpen: Boolean(document.querySelector('dialog[open]')),
    });
    if (!opens) return;
    event.preventDefault();
    dialog.showModal();
  });
}

/** Resolves to true only if the destructive button was chosen. Safe action has focus by default. */
export function confirmDialog({ title, message, confirmLabel }) {
  const dialog = document.getElementById('confirm-dialog');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-accept').textContent = confirmLabel;
  // Esc sets no return value and browsers differ on clearing the old one.
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

const form = {
  dialog: () => document.getElementById('edit-dialog'),
  name: () => document.getElementById('edit-name'),
  url: () => document.getElementById('edit-url'),
  folder: () => document.getElementById('edit-folder'),
  error: () => document.getElementById('edit-error'),
};

let submitHandler = null;
let moveSubmitHandler = null;

/** Wired once at startup; each openEditDialog call supplies its own save behaviour. */
export function initEditDialog() {
  document.getElementById('edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    form.error().textContent = '';
    try {
      await submitHandler?.();
    } catch (error) {
      form.error().textContent = error.message;
    }
  });
  document.getElementById('edit-cancel').addEventListener('click', () => form.dialog().close());

  document.getElementById('move-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = document.getElementById('move-error');
    error.textContent = '';
    try {
      await moveSubmitHandler?.();
    } catch (failure) {
      error.textContent = failure.message;
    }
  });
  document.getElementById('move-cancel').addEventListener('click', () => {
    document.getElementById('move-dialog').close();
  });
}

/** Asks where to move several nodes, optionally into a folder created on the spot. */
export function moveDialog({ roots, nodes, parentId, onMove }) {
  const dialog = document.getElementById('move-dialog');
  const folder = document.getElementById('move-folder');
  const name = document.getElementById('move-new-folder');
  document.getElementById('move-title').textContent = `移动 ${nodes.length} 项`;
  document.getElementById('move-error').textContent = '';
  name.value = '';

  // A selected folder can't be moved into itself or anything inside it.
  const excluded = nodes.filter((node) => node.url === undefined).map((node) => node.id);
  const options = folderOptions(roots, excluded);
  folder.replaceChildren(
    ...options.map((option) =>
      h('option', { value: option.id }, `${'\u00a0\u00a0\u00a0'.repeat(option.depth)}${option.title}`),
    ),
  );
  folder.value = options.some((option) => option.id === parentId) ? parentId : options[0]?.id;

  moveSubmitHandler = async () => {
    let destination = folder.value;
    let title = options.find((option) => option.id === destination)?.title;
    let createdFolderId = null;
    const newName = name.value.trim();
    if (newName) {
      createdFolderId = (await chrome.bookmarks.create({ parentId: destination, title: newName })).id;
      destination = createdFolderId;
      title = newName;
    }
    await onMove({ parentId: destination }, title, createdFolderId);
    dialog.close();
  };

  dialog.showModal();
}

function openEditDialog({ title, name, url, showUrl, roots, excludeId, parentId, onSave }) {
  document.getElementById('edit-title').textContent = title;
  document.getElementById('edit-url-field').hidden = !showUrl;
  form.name().value = name;
  form.url().value = url ?? '';
  form.error().textContent = '';

  const options = folderOptions(roots, excludeId ? [excludeId] : []);
  form.folder().replaceChildren(
    ...options.map((option) =>
      h('option', { value: option.id }, `${'   '.repeat(option.depth)}${option.title}`),
    ),
  );
  form.folder().value = options.some((option) => option.id === parentId) ? parentId : options[0]?.id;

  submitHandler = async () => {
    const values = { title: form.name().value.trim(), parentId: form.folder().value };
    if (showUrl) {
      values.url = normalizeInputUrl(form.url().value);
      if (!values.url) throw new Error('请输入有效的网址');
      values.title ||= values.url;
    } else if (!values.title) {
      throw new Error('请输入文件夹名称');
    }
    await onSave(values);
    form.dialog().close();
  };

  form.dialog().showModal();
  form.name().select();
}

export function createBookmarkDialog({ roots, parentId, name = '', url = '' }) {
  openEditDialog({
    title: '添加书签',
    name,
    url,
    showUrl: true,
    roots,
    parentId,
    onSave: async (values) => {
      await chrome.bookmarks.create(values);
    },
  });
}

export function createFolderDialog({ roots, parentId }) {
  openEditDialog({
    title: '新建文件夹',
    name: '',
    showUrl: false,
    roots,
    parentId,
    onSave: async (values) => {
      await chrome.bookmarks.create({ title: values.title, parentId: values.parentId });
    },
  });
}

export function editNodeDialog({ roots, node }) {
  const isBookmark = node.url !== undefined;
  openEditDialog({
    title: isBookmark ? '编辑书签' : '编辑文件夹',
    name: node.title,
    url: node.url,
    showUrl: isBookmark,
    roots,
    excludeId: isBookmark ? null : node.id,
    parentId: node.parentId,
    onSave: async ({ title, url, parentId }) => {
      await chrome.bookmarks.update(node.id, isBookmark ? { title, url } : { title });
      if (parentId !== node.parentId) await chrome.bookmarks.move(node.id, { parentId });
    },
  });
}
