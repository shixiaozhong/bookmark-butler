// Deleting a bookmark through the API is permanent, so every delete first saves
// a snapshot. It's kept in storage because the popup can close at any moment.
const UNDO_KEY = 'undoSnapshot';
const UNDO_WINDOW_MS = 10 * 60 * 1000;

function toSnapshot(node) {
  return {
    id: node.id,
    parentId: node.parentId,
    index: node.index,
    title: node.title,
    url: node.url,
    children: node.children?.map(toSnapshot),
  };
}

/** Returns how many of `ids` were removed and how many could not be. */
export async function removeWithUndo(ids) {
  const items = [];
  for (const id of ids) {
    const [node] = await chrome.bookmarks.getSubTree(id);
    items.push(toSnapshot(node));
  }
  await chrome.storage.local.set({ [UNDO_KEY]: { at: Date.now(), items } });

  let removed = 0;
  for (const item of items) {
    try {
      if (item.url === undefined) await chrome.bookmarks.removeTree(item.id);
      else await chrome.bookmarks.remove(item.id);
      removed++;
    } catch (error) {
      console.error('Could not remove bookmark', item.id, error);
    }
  }
  return { removed, failed: items.length - removed };
}

/** The most recent delete, if it's still recent enough to offer undoing. */
export async function getUndoSnapshot() {
  const { [UNDO_KEY]: snapshot = null } = await chrome.storage.local.get(UNDO_KEY);
  return snapshot && Date.now() - snapshot.at < UNDO_WINDOW_MS ? snapshot : null;
}

export async function discardUndo() {
  await chrome.storage.local.remove(UNDO_KEY);
}

async function exists(id) {
  try {
    await chrome.bookmarks.get(id);
    return true;
  } catch {
    return false;
  }
}

async function restore(item, parentId) {
  const details = { title: item.title, url: item.url };
  if (parentId !== undefined) {
    details.parentId = parentId;
    details.index = item.index;
  }
  const created = await chrome.bookmarks.create(details);
  for (const child of item.children ?? []) await restore(child, created.id);
}

/** Puts deleted items back where they were. Returns how many were restored. */
export async function undoRemove() {
  const snapshot = await getUndoSnapshot();
  if (!snapshot) return 0;
  // Restoring in ascending index order means each saved position is valid when it's used.
  const items = [...snapshot.items].sort((a, b) => a.index - b.index);
  let restored = 0;
  for (const item of items) {
    // The popup may have closed partway through the delete, leaving this one in place.
    if (await exists(item.id)) continue;
    // If its folder has since been deleted too, Chrome's default location beats losing it.
    await restore(item, (await exists(item.parentId)) ? item.parentId : undefined);
    restored++;
  }
  await discardUndo();
  return restored;
}

export async function openUrl(url, { active = true } = {}) {
  // Chrome refuses these from extensions, with an error that's no use to a reader.
  if (/^javascript:/i.test(url)) throw new Error('小书签只能从 Chrome 书签栏运行');
  await chrome.tabs.create({ url, active });
  if (active) window.close();
}
