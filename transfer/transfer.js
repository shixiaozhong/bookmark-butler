import { folderOptions, indexTree } from '../lib/bookmarks-model.js';
import { parseBookmarksHtml, planImport, serializeBookmarks } from '../lib/transfer.js';
import { exactKey } from '../lib/urls.js';
import { h } from '../popup/dom.js';

const $ = (id) => document.getElementById(id);

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function folderOptionElements(roots) {
  return folderOptions(roots).map((folder) =>
    h('option', { value: folder.id }, `${'   '.repeat(folder.depth)}${folder.title}`),
  );
}

function countBookmarks(nodes) {
  return nodes.reduce((sum, node) => sum + (node.url !== undefined ? 1 : countBookmarks(node.children ?? [])), 0);
}

/* Export */

function saveFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }));
  const link = h('a', { href: url, download: name });
  link.click();
  // Revoked later because a "where to save" prompt can keep the download waiting on this URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function exportBookmarks() {
  const status = $('export-status');
  status.textContent = '';
  const scope = $('export-scope').value;
  let nodes;
  if (scope) {
    nodes = await chrome.bookmarks.getSubTree(scope);
  } else {
    const [root] = await chrome.bookmarks.getTree();
    // Top-level folders with nothing in them (usually "Mobile bookmarks") are just noise in a file.
    nodes = root.children.filter((folder) => folder.children?.length);
  }
  const count = countBookmarks(nodes);
  saveFile(`bookmarks-${today()}.html`, serializeBookmarks(nodes));
  status.textContent = `已导出 ${count} 个书签`;
}

/* Import */

let parsedTree = null;
let plan = null;
let lastImportedFolderId = null;
let importing = false;

async function existingUrls() {
  const { bookmarks } = indexTree(await chrome.bookmarks.getTree());
  return new Set(bookmarks.map((bookmark) => exactKey(bookmark.url)));
}

function describePlan({ bookmarks, folders, duplicates, scripts, invalid }, includeScripts) {
  const found = `将导入 ${bookmarks} 个书签${folders ? `、${folders} 个文件夹` : ''}`;
  const skipped = [];
  if (duplicates) skipped.push(`${duplicates} 个已有的网址`);
  if (scripts && !includeScripts) skipped.push(`${scripts} 个小书签`);
  if (invalid) skipped.push(`${invalid} 个无效网址`);
  return skipped.length ? `${found}，跳过 ${skipped.join('、')}。` : `${found}。`;
}

async function updatePlan() {
  if (!parsedTree) return;
  const includeScripts = $('import-scripts').checked;
  plan = planImport(parsedTree, await existingUrls(), {
    skipExisting: $('import-skip-existing').checked,
    includeScripts,
  });
  const { counts } = plan;
  $('import-summary').textContent = describePlan(counts, includeScripts);
  $('import-scripts-option').hidden = counts.scripts === 0;
  $('import-scripts-label').textContent = `也导入 ${counts.scripts} 个小书签（点击时会运行代码，只导入你信任的文件）`;
  $('import-button').textContent = `导入 ${counts.bookmarks} 个书签`;
  $('import-button').disabled = counts.bookmarks === 0 && counts.folders === 0;
}

async function chooseFile() {
  const file = $('import-file').files[0];
  $('import-error').textContent = '';
  $('import-result').hidden = true;
  $('import-options').hidden = true;
  parsedTree = null;
  plan = null;
  if (!file) return;

  const tree = parseBookmarksHtml(await file.text());
  if (!tree.length) {
    $('import-error').textContent = '这个文件里没有找到书签。请选择浏览器导出的书签 HTML 文件。';
    return;
  }
  parsedTree = tree;
  $('import-name').value = `导入的书签 ${today()}`;
  $('import-options').hidden = false;
  await updatePlan();
}

/** Bookmarks that fail are counted rather than stopping the rest of the import. */
async function createItems(items, parentId, progress) {
  for (const item of items) {
    try {
      if (item.url !== undefined) {
        await chrome.bookmarks.create({ parentId, title: item.title, url: item.url });
        progress.created++;
      } else {
        const folder = await chrome.bookmarks.create({ parentId, title: item.title });
        await createItems(item.children, folder.id, progress);
        continue;
      }
    } catch (error) {
      console.error('Could not import', item, error);
      progress.failed += item.url !== undefined ? 1 : countBookmarks(item.children);
    }
    $('import-progress').value = progress.created + progress.failed;
  }
}

async function runImport() {
  if (!plan || importing) return;
  // Taken again now, in case bookmarks changed while the options were on screen.
  await updatePlan();
  const { items, counts } = plan;
  const title = $('import-name').value.trim() || `导入的书签 ${today()}`;

  importing = true;
  $('import-error').textContent = '';
  $('import-options').hidden = true;
  $('import-progress').hidden = false;
  $('import-progress').max = Math.max(counts.bookmarks, 1);
  $('import-progress').value = 0;
  try {
    const folder = await chrome.bookmarks.create({ parentId: $('import-parent').value, title });
    lastImportedFolderId = folder.id;
    const progress = { created: 0, failed: 0 };
    await createItems(items, folder.id, progress);
    const failed = progress.failed ? `，${progress.failed} 个失败` : '';
    $('import-result-text').textContent = `已把 ${progress.created} 个书签导入到“${title}”${failed}。`;
    $('import-undo').hidden = false;
    $('import-result').hidden = false;
  } finally {
    importing = false;
    $('import-progress').hidden = true;
    $('import-file').value = '';
    parsedTree = null;
    plan = null;
  }
}

async function undoImport() {
  if (!lastImportedFolderId) return;
  await chrome.bookmarks.removeTree(lastImportedFolderId);
  lastImportedFolderId = null;
  $('import-result-text').textContent = '已撤销这次导入。';
  $('import-undo').hidden = true;
}

/* Startup */

function reportingErrors(element, action) {
  return async () => {
    try {
      await action();
    } catch (error) {
      console.error(error);
      element.textContent = `操作失败：${error.message}`;
    }
  };
}

async function init() {
  const roots = await chrome.bookmarks.getTree();

  $('export-scope').replaceChildren(h('option', { value: '' }, '全部书签'), ...folderOptionElements(roots));
  $('import-parent').replaceChildren(...folderOptionElements(roots));
  // "Other bookmarks" when it's there, so an import doesn't crowd the bookmarks bar.
  const topLevel = roots[0].children.filter((folder) => !folder.unmodifiable);
  $('import-parent').value = (topLevel[1] ?? topLevel[0])?.id;

  const onError = $('import-error');
  $('export-button').addEventListener('click', reportingErrors($('export-status'), exportBookmarks));
  $('import-file').addEventListener('change', reportingErrors(onError, chooseFile));
  $('import-skip-existing').addEventListener('change', reportingErrors(onError, updatePlan));
  $('import-scripts').addEventListener('change', reportingErrors(onError, updatePlan));
  $('import-button').addEventListener('click', reportingErrors(onError, runImport));
  $('import-undo').addEventListener('click', reportingErrors(onError, undoImport));

  window.addEventListener('beforeunload', (event) => {
    if (importing) event.preventDefault();
  });
}

init();
