export const ROOT_ID = '0';

/** Flattens the tree from chrome.bookmarks.getTree() into lookups the views share. */
export function indexTree(roots) {
  const bookmarks = [];
  const nodes = new Map();

  const walk = (node, path) => {
    if (node.url !== undefined) {
      const entry = { ...node, path: path.join(' / ') };
      bookmarks.push(entry);
      nodes.set(node.id, entry);
      return 1;
    }
    const childPath = node.id === ROOT_ID ? [] : [...path, node.title];
    let count = 0;
    for (const child of node.children ?? []) count += walk(child, childPath);
    nodes.set(node.id, { ...node, path: path.join(' / '), count });
    return count;
  };

  for (const root of roots) walk(root, []);
  return { bookmarks, nodes };
}

/** Chrome refuses edits to the hidden root, its top-level folders and managed bookmarks. */
export function canModify(node) {
  return node.id !== ROOT_ID && node.parentId !== ROOT_ID && !node.unmodifiable;
}

export function canHoldChildren(node) {
  return Boolean(node) && node.url === undefined && node.id !== ROOT_ID && !node.unmodifiable;
}

/** The folders from the hidden root down to `id`, inclusive. */
export function folderTrail(nodes, id) {
  const trail = [];
  for (let node = nodes.get(id); node; node = nodes.get(node.parentId)) trail.unshift(node);
  return trail;
}

/**
 * The selected nodes in the order they appear in the tree. Anything inside a
 * selected folder is left out, because acting on the folder already covers it.
 */
export function topmostInOrder(roots, ids) {
  const selected = new Set(ids);
  const found = [];
  const walk = (node) => {
    if (selected.has(node.id)) {
      found.push(node);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  return found;
}

function countSubfolders(node) {
  return (node.children ?? []).reduce((sum, child) => sum + 1 + countSubfolders(child), 0);
}

/**
 * Folders with no bookmarks anywhere inside. A folder holding only empty folders
 * counts, and it's the one reported: deleting it takes the ones inside with it.
 */
export function findEmptyFolders(nodes) {
  const isEmpty = (node) => node?.url === undefined && node.count === 0 && canModify(node);
  const found = [];
  for (const node of nodes.values()) {
    if (isEmpty(node) && !isEmpty(nodes.get(node.parentId))) {
      found.push({ id: node.id, title: node.title, path: node.path, subfolders: countSubfolders(node) });
    }
  }
  return found;
}

/** Folders a bookmark can live in, depth-first. `excludeIds` drops those folders and their subtrees. */
export function folderOptions(roots, excludeIds = []) {
  const excluded = new Set(excludeIds);
  const options = [];
  const walk = (node, depth) => {
    if (node.url !== undefined || excluded.has(node.id) || node.unmodifiable) return;
    if (node.id !== ROOT_ID) options.push({ id: node.id, title: node.title, depth });
    for (const child of node.children ?? []) {
      walk(child, node.id === ROOT_ID ? 0 : depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);
  return options;
}

function matchScore(bookmark, tokens) {
  const title = bookmark.title.toLowerCase();
  const url = bookmark.url.toLowerCase();
  const path = bookmark.path.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (title.startsWith(token)) score += 8;
    else if (title.includes(token)) score += 4;
    else if (url.includes(token)) score += 2;
    else if (path.includes(token)) score += 1;
    else return 0;
  }
  return score;
}

/** Every whitespace-separated term must match somewhere; title hits rank above URL and folder hits. */
export function searchBookmarks(bookmarks, query, limit = 100) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { items: [], total: 0 };
  const scored = [];
  for (const bookmark of bookmarks) {
    const score = matchScore(bookmark, tokens);
    if (score) scored.push({ bookmark, score });
  }
  scored.sort((a, b) => b.score - a.score || a.bookmark.title.localeCompare(b.bookmark.title));
  return { items: scored.slice(0, limit).map((s) => s.bookmark), total: scored.length };
}
