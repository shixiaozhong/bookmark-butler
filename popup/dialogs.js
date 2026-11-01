import { folderOptions } from '../lib/bookmarks-model.js';
import { normalizeInputUrl } from '../lib/urls.js';
import { h } from './dom.js';

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
}

function openEditDialog({ title, name, url, showUrl, roots, excludeId, parentId, onSave }) {
  document.getElementById('edit-title').textContent = title;
  document.getElementById('edit-url-field').hidden = !showUrl;
  form.name().value = name;
  form.url().value = url ?? '';
  form.error().textContent = '';

  const options = folderOptions(roots, excludeId);
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
