import { canHoldChildren, ROOT_ID } from './bookmarks-model.js';

/** Which part of a tile the pointer is over. `ratio` is 0 at its left edge and 1 at its right. */
export function dropZone(node, ratio) {
  if (node.url !== undefined) return ratio < 0.5 ? 'before' : 'after';
  // Top-level folders have no siblings a bookmark could sit between.
  if (node.parentId === ROOT_ID) return 'inside';
  if (ratio < 0.25) return 'before';
  return ratio > 0.75 ? 'after' : 'inside';
}

function isSelfOrDescendant(nodes, id, ancestorId) {
  for (let current = nodes.get(id); current; current = nodes.get(current.parentId)) {
    if (current.id === ancestorId) return true;
  }
  return false;
}

/**
 * Where dropping `dragged` on `target` puts it, or null if that isn't allowed or
 * changes nothing. `index` counts positions before `dragged` is taken out of its
 * folder, which is how chrome.bookmarks.move reads it: "just before the node at
 * this position" holds whichever direction the node is moving.
 */
export function resolveDrop(nodes, dragged, target, zone) {
  if (isSelfOrDescendant(nodes, target.id, dragged.id)) return null;

  const parentId = zone === 'inside' ? target.id : target.parentId;
  if (!canHoldChildren(nodes.get(parentId))) return null;

  const index =
    zone === 'inside' ? (target.children?.length ?? 0) : target.index + (zone === 'after' ? 1 : 0);

  const staysPut =
    dragged.parentId === parentId && (index === dragged.index || index === dragged.index + 1);
  return staysPut ? null : { parentId, index };
}

/** The destination for moving a node one place back or forward in its folder, or null at either end. */
export function resolveStep(nodes, node, direction) {
  const parent = nodes.get(node.parentId);
  if (!canHoldChildren(parent)) return null;
  if (direction === 'back') {
    return node.index > 0 ? { parentId: parent.id, index: node.index - 1 } : null;
  }
  return node.index < parent.children.length - 1 ? { parentId: parent.id, index: node.index + 2 } : null;
}
