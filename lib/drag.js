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

/** True if the group already sits together in `parentId`, with `index` touching it. */
function alreadyThere(group, parentId, index) {
  if (group.some((node) => node.parentId !== parentId)) return false;
  const positions = group.map((node) => node.index).sort((a, b) => a - b);
  const first = positions[0];
  const last = positions[positions.length - 1];
  return last - first === positions.length - 1 && index >= first && index <= last + 1;
}

/**
 * Where dropping `group` (one or more nodes) on `target` puts it, or null if that
 * isn't allowed or changes nothing. `index` is the position among the folder's
 * children as they stand now, with the group still in place.
 */
export function resolveDrop(nodes, group, target, zone) {
  if (group.some((node) => isSelfOrDescendant(nodes, target.id, node.id))) return null;

  const parentId = zone === 'inside' ? target.id : target.parentId;
  if (!canHoldChildren(nodes.get(parentId))) return null;

  const index =
    zone === 'inside' ? (target.children?.length ?? 0) : target.index + (zone === 'after' ? 1 : 0);

  return alreadyThere(group, parentId, index) ? null : { parentId, index };
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
