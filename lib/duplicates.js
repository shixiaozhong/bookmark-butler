import { exactKey, looseKey } from './urls.js';

/**
 * Groups bookmarks that likely point at the same page. `removable` holds the
 * copies that are safe to preselect: those with a byte-equivalent URL to an
 * older bookmark. Merely similar URLs are never preselected, since http vs
 * https or a dropped query can occasionally be a different page.
 */
export function findDuplicates(bookmarks) {
  const byKey = new Map();
  for (const bookmark of bookmarks) {
    if (bookmark.unmodifiable) continue;
    const key = looseKey(bookmark.url);
    const group = byKey.get(key);
    if (group) group.push(bookmark);
    else byKey.set(key, [bookmark]);
  }

  const groups = [];
  for (const [key, items] of byKey) {
    if (items.length < 2) continue;
    // Imported bookmarks often share a timestamp. Ids are numeric strings that
    // grow over time, so compare them as numbers: "9" is older than "10".
    items.sort(
      (a, b) =>
        (a.dateAdded ?? 0) - (b.dateAdded ?? 0) || a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
    const seen = new Set();
    const removable = [];
    for (const item of items) {
      const exact = exactKey(item.url);
      if (seen.has(exact)) removable.push(item.id);
      else seen.add(exact);
    }
    groups.push({ key, items, removable, exact: seen.size === 1 });
  }
  return groups.sort((a, b) => Number(b.exact) - Number(a.exact) || b.items.length - a.items.length);
}
