import { searchBookmarks } from './bookmarks-model.js';

const MAX_SUGGESTIONS = 6;

/** Chrome won't navigate to these from an extension, so they aren't offered. */
const canOpen = (bookmark) => !/^(javascript|data|vbscript):/i.test(bookmark.url);

/**
 * Suggestion text is parsed as XML, and one bad character makes Chrome reject the
 * whole list. Titles come from web pages, so they can contain anything.
 */
export function escapeXml(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Address bar suggestions. Each URL appears once, since Chrome needs `content` to be unique. */
export function buildSuggestions(bookmarks, query) {
  const seen = new Set();
  const suggestions = [];
  for (const bookmark of searchBookmarks(bookmarks, query).items) {
    if (!canOpen(bookmark) || seen.has(bookmark.url)) continue;
    seen.add(bookmark.url);
    const path = bookmark.path ? ` <dim>${escapeXml(bookmark.path)}</dim>` : '';
    suggestions.push({
      content: bookmark.url,
      description: `<match>${escapeXml(bookmark.title || bookmark.url)}</match>${path} <url>${escapeXml(bookmark.url)}</url>`,
    });
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

/**
 * The URL to open when Enter is pressed. `text` is a suggestion's URL if one was
 * picked, or else what was typed. Only a saved bookmark is ever navigated to
 * directly, so typed text can't send the browser somewhere unexpected.
 */
export function resolveEntered(bookmarks, text) {
  const picked = bookmarks.find((bookmark) => bookmark.url === text && canOpen(bookmark));
  if (picked) return picked.url;
  const best = searchBookmarks(bookmarks, text).items.find(canOpen);
  return best?.url ?? `chrome://bookmarks/?q=${encodeURIComponent(text)}`;
}
