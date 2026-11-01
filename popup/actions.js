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

/**
 * Moves nodes to a spot in a folder, keeping their order. `index` is a position
 * among the folder's current children (the end if left out). Each node is placed
 * just before the first child that isn't moving, which stays correct as positions
 * shift. Returns where they came from, for undoMoves.
 */
export async function moveNodes(ids, { parentId, index }) {
  const origins = [];
  for (const id of ids) {
    const [{ parentId: from, index: at }] = await chrome.bookmarks.get(id);
    origins.push({ id, parentId: from, index: at });
  }
  const moving = new Set(ids);
  const siblings = await chrome.bookmarks.getChildren(parentId);
  const anchorId = siblings.slice(index ?? siblings.length).find((child) => !moving.has(child.id))?.id;

  let moved = 0;
  for (const id of ids) {
    try {
      const position = anchorId
        ? (await chrome.bookmarks.get(anchorId))[0].index
        : (await chrome.bookmarks.getChildren(parentId)).length;
      await chrome.bookmarks.move(id, { parentId, index: position });
      moved++;
    } catch (error) {
      console.error('Could not move bookmark', id, error);
    }
  }
  return { origins, moved, failed: ids.length - moved };
}

/**
 * Puts moved nodes back in two passes. Nodes still in their original folder go to
 * its end first, so none of them sit before a position being filled. Then each one
 * goes back, lowest position first, which makes every saved position correct when
 * it's used. Nodes that have since been deleted are skipped.
 */
export async function undoMoves(origins) {
  for (const { id, parentId } of origins) {
    try {
      const [current] = await chrome.bookmarks.get(id);
      if (current.parentId !== parentId) continue;
      const { length } = await chrome.bookmarks.getChildren(parentId);
      await chrome.bookmarks.move(id, { parentId, index: length });
    } catch (error) {
      console.error('Could not prepare to restore bookmark', id, error);
    }
  }
  const ordered = [...origins].sort((a, b) => a.index - b.index);
  for (const { id, parentId, index } of ordered) {
    try {
      await chrome.bookmarks.move(id, { parentId, index });
    } catch (error) {
      console.error('Could not restore bookmark', id, error);
    }
  }
}

export async function openUrl(url, { active = true } = {}) {
  // Chrome refuses these from extensions, with an error that's no use to a reader.
  if (/^javascript:/i.test(url)) throw new Error('小书签只能从 Chrome 书签栏运行');
  await chrome.tabs.create({ url, active });
  if (active) window.close();
}
