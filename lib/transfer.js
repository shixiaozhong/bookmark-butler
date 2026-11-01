// Reads and writes the Netscape bookmark file format, the HTML that Chrome, Edge,
// Firefox and Safari all use for importing and exporting bookmarks.
import { ROOT_ID } from './bookmarks-model.js';
import { exactKey } from './urls.js';

const HEADER = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
`;

/** Bookmarks that run code when clicked, which a file from elsewhere shouldn't add unasked. */
const SCRIPT_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:']);
/** Firefox's saved-query folders. They only mean something inside Firefox. */
const UNSUPPORTED_PROTOCOLS = new Set(['place:']);

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function dateAttribute(name, milliseconds) {
  return milliseconds ? ` ${name}="${Math.floor(milliseconds / 1000)}"` : '';
}

function isBookmarksBar(node) {
  return node.folderType === 'bookmarks-bar' || (node.parentId === ROOT_ID && node.id === '1');
}

function serializeNodes(nodes, depth) {
  const indent = '    '.repeat(depth);
  let html = '';
  for (const node of nodes) {
    if (node.url !== undefined) {
      html += `${indent}<DT><A HREF="${escapeHtml(node.url)}"${dateAttribute('ADD_DATE', node.dateAdded)}>${escapeHtml(node.title)}</A>\n`;
    } else {
      const toolbar = isBookmarksBar(node) ? ' PERSONAL_TOOLBAR_FOLDER="true"' : '';
      html += `${indent}<DT><H3${dateAttribute('ADD_DATE', node.dateAdded)}${dateAttribute('LAST_MODIFIED', node.dateGroupModified)}${toolbar}>${escapeHtml(node.title)}</H3>\n`;
      html += `${indent}<DL><p>\n${serializeNodes(node.children ?? [], depth + 1)}${indent}</DL><p>\n`;
    }
  }
  return html;
}

export function serializeBookmarks(nodes) {
  return `${HEADER}<DL><p>\n${serializeNodes(nodes, 1)}</DL><p>\n`;
}

const childList = (element) => element.querySelector(':scope > dl');

/**
 * A folder's list normally sits inside its `<DT>`. Some tools close the `<DT>`
 * first, leaving it as the next sibling. A folder description is the other case:
 * `<DD>` closes the `<DT>`, so the HTML parser puts the list inside the `<DD>`.
 */
function folderList(term) {
  const own = childList(term);
  if (own) return own;
  let next = term.nextElementSibling;
  if (next?.tagName === 'DD') {
    const described = childList(next);
    if (described) return described;
    next = next.nextElementSibling;
  }
  return next?.tagName === 'DL' ? next : null;
}

/**
 * Reads a `<DL>` list. A list that doesn't belong to a folder is read in place,
 * so an unusual file loses its nesting at worst and never its bookmarks.
 */
function readList(list) {
  const items = [];
  const claimed = new Set();
  for (const element of list.children) {
    if (claimed.has(element)) continue;
    if (element.tagName === 'P' || element.tagName === 'DL') {
      items.push(...readList(element));
    } else if (element.tagName === 'DD') {
      const inner = childList(element);
      if (inner && !claimed.has(inner)) items.push(...readList(inner));
    } else if (element.tagName === 'DT') {
      const heading = element.querySelector(':scope > h3');
      const link = element.querySelector(':scope > a');
      if (heading) {
        const inner = folderList(element);
        if (inner) claimed.add(inner);
        items.push({ title: heading.textContent.trim(), children: inner ? readList(inner) : [] });
      } else {
        if (link) items.push({ title: link.textContent.trim(), url: link.getAttribute('href') ?? '' });
        const inner = childList(element);
        if (inner) items.push(...readList(inner));
      }
    }
  }
  return items;
}

/**
 * Returns the file's bookmarks as a tree of `{ title, url }` and `{ title, children }`.
 * DOMParser builds an inert document, so nothing in the file can run.
 */
export function parseBookmarksHtml(html, parser = new DOMParser()) {
  const document = parser.parseFromString(html, 'text/html');
  const list = document.querySelector('dl');
  return list ? readList(list) : [];
}

function classify(url) {
  try {
    const { protocol } = new URL(url);
    if (UNSUPPORTED_PROTOCOLS.has(protocol)) return 'invalid';
    return SCRIPT_PROTOCOLS.has(protocol) ? 'script' : 'bookmark';
  } catch {
    return 'invalid';
  }
}

/**
 * Decides what an import will actually create. `items` is what's left to create;
 * `counts` says what was found and skipped, for showing before anything changes.
 * A folder that only had skipped bookmarks in it is dropped rather than left empty.
 */
export function planImport(tree, existingUrls, { skipExisting = true, includeScripts = false } = {}) {
  const seen = new Set(existingUrls);
  const counts = { bookmarks: 0, folders: 0, duplicates: 0, scripts: 0, invalid: 0 };

  const filter = (nodes) => {
    const kept = [];
    for (const node of nodes) {
      if (node.url === undefined) {
        const children = filter(node.children);
        if (children.length || !node.children.length) {
          counts.folders++;
          kept.push({ title: node.title, children });
        }
        continue;
      }
      const kind = classify(node.url);
      if (kind === 'invalid') {
        counts.invalid++;
        continue;
      }
      if (kind === 'script') {
        counts.scripts++;
        if (!includeScripts) continue;
      }
      const key = exactKey(node.url);
      if (skipExisting && seen.has(key)) {
        counts.duplicates++;
        continue;
      }
      seen.add(key);
      counts.bookmarks++;
      kept.push({ title: node.title || node.url, url: node.url });
    }
    return kept;
  };

  return { items: filter(tree), counts };
}
