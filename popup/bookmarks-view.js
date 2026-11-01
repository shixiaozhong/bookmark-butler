import { canHoldChildren, canModify, folderTrail, ROOT_ID, searchBookmarks, topmostInOrder } from '../lib/bookmarks-model.js';
import { dropZone, resolveDrop, resolveStep } from '../lib/drag.js';
import { plural, t } from '../lib/i18n.js';
import { parseHttpUrl } from '../lib/urls.js';
import { moveNodes, undoMoves } from './actions.js';
import { editNodeDialog, moveDialog } from './dialogs.js';
import { favicon, h, icon } from './dom.js';

const SPRING_OPEN_MS = 600;
const AUTOSCROLL_EDGE_PX = 28;
const AUTOSCROLL_STEP_PX = 8;
const ZONE_CLASSES = { before: 'drop-before', after: 'drop-after', inside: 'drop-inside' };
const MARKER_CLASSES = [...Object.values(ZONE_CLASSES), 'drop-end'];

/** The search box and a grid of one folder's contents, with a path back up. */
export function createBookmarksView(app) {
  const panel = document.getElementById('bookmarks-panel');
  const body = document.getElementById('bookmarks-body');
  const search = document.getElementById('search');
  const crumbsNav = document.getElementById('crumbs-nav');
  const crumbs = document.getElementById('crumbs');

  const selectionBar = document.getElementById('selection-bar');
  const selectButton = document.getElementById('select-mode');

  let drag = null;
  let selecting = false;
  // Selection survives moving between folders and searching, so a set can be built
  // from several places. Only the last-clicked tile needs remembering for Shift ranges.
  const selected = new Set();
  let rangeAnchorId = null;

  /* Selecting */

  const selectedNodes = () => topmostInOrder(app.roots, selected);

  function visibleSelectableIds() {
    const grid = currentGrid();
    return grid ? [...grid.querySelectorAll('.tile-check')].map((box) => box.closest('.tile').dataset.id) : [];
  }

  function updateSelectionBar() {
    selectionBar.hidden = !selecting;
    if (!selecting) return;
    const nothing = selected.size === 0;
    document.getElementById('selection-count').textContent = t('selected_count', selected.size);
    document.getElementById('selection-move').disabled = nothing;
    document.getElementById('selection-delete').disabled = nothing;
    const visible = visibleSelectableIds();
    const all = document.getElementById('selection-all');
    all.textContent = visible.length && visible.every((id) => selected.has(id)) ? t('deselect_all') : t('select_all');
    all.disabled = visible.length === 0;
  }

  /** Updates tiles in place, so ticking one doesn't rebuild the grid or lose focus. */
  function syncSelection() {
    for (const tile of body.querySelectorAll('.grid:not(.drag-stash) .tile')) {
      const on = selected.has(tile.dataset.id);
      tile.classList.toggle('selected', on);
      const box = tile.querySelector('.tile-check');
      if (box) box.checked = on;
    }
    updateSelectionBar();
  }

  function setSelected(id, on, extendRange) {
    const visible = visibleSelectableIds();
    const from = visible.indexOf(rangeAnchorId);
    const to = visible.indexOf(id);
    if (extendRange && from >= 0 && to >= 0) {
      for (const each of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (on) selected.add(each);
        else selected.delete(each);
      }
    } else if (on) {
      selected.add(id);
    } else {
      selected.delete(id);
    }
    rangeAnchorId = id;
    syncSelection();
  }

  function setSelecting(on) {
    selecting = on;
    selected.clear();
    rangeAnchorId = null;
    selectButton.setAttribute('aria-pressed', String(on));
    render();
    updateSelectionBar();
  }

  function selectionBox(node) {
    if (!selecting || !canModify(node)) return null;
    return h('input', {
      type: 'checkbox',
      class: 'tile-check',
      checked: selected.has(node.id),
      'aria-label': t('select_item', node.title || node.url),
      onclick: (event) => setSelected(node.id, event.target.checked, event.shiftKey),
    });
  }

  function deleteSelection() {
    const nodes = selectedNodes();
    const inFolders = nodes.reduce((sum, node) => sum + (node.url === undefined ? (app.index.nodes.get(node.id)?.count ?? 0) : 0), 0);
    const message = inFolders
      ? plural('delete_items_and_contents', inFolders, nodes.length)
      : plural('delete_items', nodes.length);
    app.run(async () => {
      const removed = await app.removeNodes(nodes.map((node) => node.id), { title: t('delete_selection_title'), message });
      if (removed) setSelecting(false);
    });
  }

  selectButton.addEventListener('click', () => setSelecting(!selecting));
  document.getElementById('selection-done').addEventListener('click', () => setSelecting(false));
  document.getElementById('selection-delete').addEventListener('click', deleteSelection);
  document.getElementById('selection-all').addEventListener('click', () => {
    const visible = visibleSelectableIds();
    const clearing = visible.every((id) => selected.has(id));
    for (const id of visible) {
      if (clearing) selected.delete(id);
      else selected.add(id);
    }
    syncSelection();
  });
  document.getElementById('selection-move').addEventListener('click', () => {
    const current = app.index.nodes.get(app.folderId);
    moveDialog({
      roots: app.roots,
      nodes: selectedNodes(),
      parentId: canHoldChildren(current) ? current.id : null,
      onMove: (destination, title, createdFolderId) =>
        moveAndReport(selectedNodes(), destination, { title, createdFolderId, endSelection: true }),
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !selecting || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    setSelecting(false);
  });

  /* Tiles */

  function actionButton(label, iconName, onClick) {
    return h(
      'button',
      {
        type: 'button',
        class: 'icon-button tiny',
        title: label,
        'aria-label': label,
        onclick: () => onClick(),
      },
      icon(iconName),
    );
  }

  function tileActions(node) {
    if (selecting || !canModify(node)) return null;
    const label = node.title || node.url;
    return h(
      'div',
      { class: 'tile-actions' },
      actionButton(t('edit_item', label), 'edit', () => editNodeDialog({ roots: app.roots, node })),
      actionButton(t('delete_item', label), 'trash', () => app.removeNode(node)),
    );
  }

  function open(event, url) {
    event.preventDefault();
    const background = event.button === 1 || event.metaKey || event.ctrlKey;
    app.run(() => app.openUrl(url, { active: !background }));
  }

  function bookmarkTile(node, { showPath = false } = {}) {
    const label = node.title || node.url;
    const link = h(
      'a',
      {
        class: 'tile-main',
        // Non-web URLs (bookmarklets, chrome://) only ever open through the click handler.
        href: parseHttpUrl(node.url) ? node.url : '#',
        title: `${label}\n${node.url}`,
        onclick: (event) => {
          if (!selecting) {
            open(event, node.url);
            return;
          }
          event.preventDefault();
          if (canModify(node)) setSelected(node.id, !selected.has(node.id), event.shiftKey);
        },
        onauxclick: (event) => {
          if (event.button === 1) open(event, node.url);
        },
      },
      h('span', { class: 'tile-icon' }, favicon(node.url, 64)),
      h('span', { class: 'tile-title' }, label),
      showPath ? h('span', { class: 'meta tile-path' }, node.path || node.url) : null,
    );
    const tile = h(
      'li',
      { class: `tile${selecting && selected.has(node.id) ? ' selected' : ''}`, 'data-id': node.id },
      link,
      selectionBox(node),
      tileActions(node),
    );
    // Search results have no meaningful order, so only a folder's own view can be rearranged.
    if (!showPath && canModify(node)) {
      // A link is draggable by itself and would otherwise take the drag from its tile.
      link.draggable = false;
      tile.draggable = true;
    }
    return tile;
  }

  function folderTile(node) {
    const count = app.index.nodes.get(node.id)?.count ?? 0;
    const tile = h(
      'li',
      { class: `tile${selecting && selected.has(node.id) ? ' selected' : ''}`, 'data-id': node.id },
      h(
        'button',
        {
          type: 'button',
          class: 'tile-main',
          title: node.title,
          'aria-label': plural('folder_label', count, node.title),
          onclick: () => showFolder(node.id),
        },
        h('span', { class: 'tile-icon' }, icon('folder', 'folder-icon'), count ? h('span', { class: 'tile-count' }, String(count)) : null),
        h('span', { class: 'tile-title' }, node.title),
      ),
      selectionBox(node),
      tileActions(node),
    );
    if (canModify(node)) tile.draggable = true;
    return tile;
  }

  function folderGrid(folder) {
    const children = folder?.children ?? [];
    return h(
      'ul',
      { class: 'grid' },
      children.length
        ? children.map((child) => {
            const node = app.index.nodes.get(child.id) ?? child;
            return node.url === undefined ? folderTile(node) : bookmarkTile(node);
          })
        : h('li', { class: 'grid-empty' }, t('folder_empty')),
    );
  }

  const currentGrid = () => body.querySelector('.grid:not(.drag-stash)');
  const tileElement = (id) => currentGrid()?.querySelector(`.tile[data-id="${CSS.escape(id)}"]`);

  /* Path */

  function renderCrumbs() {
    const trail = folderTrail(app.index.nodes, app.folderId);
    crumbs.replaceChildren(
      ...trail.map((node, position) =>
        h(
          'li',
          {},
          position ? icon('chevron', 'crumb-separator') : null,
          h(
            'button',
            {
              type: 'button',
              class: 'crumb',
              'data-id': node.id,
              title: node.id === ROOT_ID ? t('crumb_all') : node.title,
              'aria-current': position === trail.length - 1 ? 'page' : null,
              onclick: () => showFolder(node.id),
            },
            node.id === ROOT_ID ? t('crumb_all') : node.title,
          ),
        ),
      ),
    );
  }

  /* Rendering */

  function renderResults(query) {
    const { items, total } = searchBookmarks(app.index.bookmarks, query);
    if (!total) {
      body.replaceChildren(h('p', { class: 'empty' }, t('no_results', query.trim())));
      return;
    }
    body.replaceChildren(h('ul', { class: 'grid' }, items.map((node) => bookmarkTile(node, { showPath: true }))));
    if (total > items.length) {
      body.append(h('p', { class: 'hint' }, t('results_capped', items.length, total)));
    }
  }

  function render() {
    // Replacing the dragged tile would cancel the drag, so changes wait for it to end.
    if (drag) {
      drag.renderWhenDone = true;
      return;
    }
    for (const id of selected) {
      if (!app.index.nodes.has(id)) selected.delete(id);
    }
    const { scrollTop } = body;
    // Rebuilding drops focus, which keyboard users would otherwise lose after every change.
    const focusedId = body.contains(document.activeElement)
      ? document.activeElement.closest('.tile')?.dataset.id
      : null;
    const query = search.value;
    crumbsNav.hidden = Boolean(query.trim());
    if (query.trim()) {
      renderResults(query);
    } else {
      renderCrumbs();
      body.replaceChildren(folderGrid(app.index.nodes.get(app.folderId)));
    }
    body.scrollTop = scrollTop;
    if (focusedId) tileElement(focusedId)?.querySelector('.tile-main')?.focus();
    updateSelectionBar();
  }

  function showFolder(id) {
    // Going back up, return to the folder you came from rather than the top of the list.
    const trail = folderTrail(app.index.nodes, app.folderId);
    const position = trail.findIndex((node) => node.id === id);
    const cameFromId = position >= 0 ? trail[position + 1]?.id : null;

    app.setFolder(id);
    render();
    body.scrollTop = 0;
    const tile = (cameFromId && tileElement(cameFromId)) || currentGrid()?.querySelector('.tile');
    tile?.querySelector('.tile-main')?.focus();
  }

  /* Rearranging */

  async function moveAndReport(nodes, destination, { title, createdFolderId = null, endSelection = false } = {}) {
    const label = title ?? app.index.nodes.get(destination.parentId)?.title;
    const { origins, moved, failed } = await moveNodes(nodes.map((node) => node.id), destination);
    if (endSelection) setSelecting(false);
    if (failed) {
      app.notify(t('move_partial', moved, failed));
      return;
    }
    // Reordering within a folder shows for itself. Anything else is easy to lose track of.
    const leftFolder = nodes.some((node) => node.parentId !== destination.parentId);
    if (nodes.length === 1 && !leftFolder) return;
    app.notify(nodes.length > 1 ? t('moved_items', nodes.length, label) : t('moved_to_folder', label), {
      actionLabel: t('undo'),
      hideAfterMs: 10_000,
      onAction: async () => {
        await undoMoves(origins);
        // Chrome refuses to remove a folder with anything in it, so what you've added since is safe.
        if (createdFolderId) await chrome.bookmarks.remove(createdFolderId).catch(() => {});
        app.notify(t('move_undone'));
      },
    });
  }

  function clearDropMarker() {
    if (!drag) return;
    drag.marked?.classList.remove(...MARKER_CLASSES);
    drag.marked = null;
    drag.destination = null;
  }

  function cancelSpring() {
    if (!drag) return;
    clearTimeout(drag.springTimer);
    drag.springId = null;
  }

  /**
   * Enters a folder mid-drag. The dragged tile has to stay in the document or
   * Chrome ends the drag, so the grid holding it is hidden until the drag is over.
   */
  function springInto(id) {
    clearDropMarker();
    app.setFolder(id);
    const previous = currentGrid();
    if (previous?.contains(drag.tile)) previous.classList.add('drag-stash');
    else previous?.remove();
    body.append(folderGrid(app.index.nodes.get(id)));
    body.scrollTop = 0;
    renderCrumbs();
  }

  function updateSpring({ el, node, zone }) {
    const opensFolder =
      el !== body &&
      zone === 'inside' &&
      node.id !== app.folderId &&
      !drag.nodes.some((dragged) => dragged.id === node.id) &&
      node.children?.length;
    if (!opensFolder) {
      cancelSpring();
      return;
    }
    if (drag.springId === node.id) return;
    cancelSpring();
    drag.springId = node.id;
    drag.springTimer = setTimeout(() => {
      if (!drag) return;
      drag.springId = null;
      springInto(node.id);
    }, SPRING_OPEN_MS);
  }

  function autoscroll(clientY) {
    const { top, bottom } = body.getBoundingClientRect();
    if (clientY < top || clientY > bottom) return;
    if (clientY < top + AUTOSCROLL_EDGE_PX) body.scrollTop -= AUTOSCROLL_STEP_PX;
    else if (clientY > bottom - AUTOSCROLL_EDGE_PX) body.scrollTop += AUTOSCROLL_STEP_PX;
  }

  /** What's under the pointer: a tile, a path segment, or empty space in the current folder. */
  function dropTargetAt(event) {
    const el = event.target.closest?.('.tile, .crumb');
    if (el) {
      const node = app.index.nodes.get(el.dataset.id);
      if (!node) return null;
      if (el.classList.contains('crumb')) return { el, node, zone: 'inside' };
      const { left, width } = el.getBoundingClientRect();
      return { el, node, zone: dropZone(node, (event.clientX - left) / width) };
    }
    if (!body.contains(event.target)) return null;
    const folder = app.index.nodes.get(app.folderId);
    return folder ? { el: body, node: folder, zone: 'inside' } : null;
  }

  body.addEventListener('dragstart', (event) => {
    const tile = event.target.closest?.('.tile[draggable="true"]');
    const node = tile && app.index.nodes.get(tile.dataset.id);
    if (!node) return;
    // Dragging a ticked tile takes all the ticked ones with it. An unticked tile goes alone.
    const nodes = selecting && selected.has(node.id) ? selectedNodes() : [node];
    drag = { nodes, tile, destination: null, marked: null, springId: null, springTimer: null, renderWhenDone: false, badge: null };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', node.url ?? node.title);
    if (nodes.length > 1) {
      drag.badge = h('div', { class: 'drag-count' }, t('drag_count', nodes.length));
      document.body.append(drag.badge);
      event.dataTransfer.setDragImage(drag.badge, 12, 12);
    }
    // Styled a frame later, or the browser would use the faded tile as the drag image.
    const moving = new Set(nodes.map((each) => each.id));
    requestAnimationFrame(() => {
      for (const each of body.querySelectorAll('.tile')) {
        if (moving.has(each.dataset.id)) each.classList.add('dragging');
      }
    });
  });

  // Chrome allows a drop based on whichever of dragenter and dragover came last,
  // so both must accept it. Otherwise letting go just after the pointer crosses
  // into a child element, like a folder's icon, silently does nothing.
  function handleDragPosition(event) {
    if (!drag) return;
    autoscroll(event.clientY);
    const target = dropTargetAt(event);
    if (!target) {
      clearDropMarker();
      cancelSpring();
      return;
    }
    updateSpring(target);
    const destination = resolveDrop(app.index.nodes, drag.nodes, target.node, target.zone);
    if (!destination) {
      clearDropMarker();
      return;
    }
    // Calling preventDefault is what marks this spot as a valid place to drop.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearDropMarker();
    target.el.classList.add(target.el === body ? 'drop-end' : ZONE_CLASSES[target.zone]);
    drag.marked = target.el;
    drag.destination = destination;
  }

  panel.addEventListener('dragenter', handleDragPosition);
  panel.addEventListener('dragover', handleDragPosition);

  panel.addEventListener('dragleave', (event) => {
    if (drag && !panel.contains(event.relatedTarget)) {
      clearDropMarker();
      cancelSpring();
    }
  });

  panel.addEventListener('drop', (event) => {
    if (!drag?.destination) return;
    event.preventDefault();
    const { nodes, destination } = drag;
    // Moving the selection finishes with it. Dragging an unticked tile leaves it alone.
    const endSelection = selecting && nodes.every((node) => selected.has(node.id));
    app.run(() => moveAndReport(nodes, destination, { endSelection }));
  });

  body.addEventListener('dragend', () => {
    if (!drag) return;
    clearDropMarker();
    cancelSpring();
    drag.badge?.remove();
    for (const each of body.querySelectorAll('.dragging')) each.classList.remove('dragging');
    const entered = body.querySelector('.drag-stash');
    const needsRender = drag.renderWhenDone || entered;
    drag = null;
    entered?.remove();
    if (needsRender) render();
  });

  /* Keyboard */

  search.addEventListener('input', () => {
    render();
    if (search.value.trim()) body.scrollTop = 0;
  });

  search.addEventListener('keydown', (event) => {
    const first = body.querySelector('.tile-main');
    if (!first) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      first.focus();
    } else if (event.key === 'Enter' && search.value.trim()) {
      event.preventDefault();
      first.click();
    }
  });

  body.addEventListener('keydown', (event) => {
    const current = event.target.closest?.('.tile-main');
    if (!current) return;
    const isBack = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const isForward = event.key === 'ArrowRight' || event.key === 'ArrowDown';

    if (selecting && event.key === ' ') {
      event.preventDefault();
      const node = app.index.nodes.get(current.closest('.tile').dataset.id);
      if (canModify(node)) setSelected(node.id, !selected.has(node.id), event.shiftKey);
      return;
    }

    // The keyboard way to do what dragging does.
    if (event.altKey && (isBack || isForward)) {
      event.preventDefault();
      const node = app.index.nodes.get(current.closest('.tile').dataset.id);
      if (search.value.trim() || !canModify(node)) return;
      const destination = resolveStep(app.index.nodes, node, isBack ? 'back' : 'forward');
      if (destination) app.run(() => moveAndReport([node], destination));
      return;
    }

    if (event.key === 'Backspace' && !search.value.trim()) {
      const parentId = app.index.nodes.get(app.folderId)?.parentId;
      if (parentId !== undefined) {
        event.preventDefault();
        showFolder(parentId);
      }
      return;
    }

    if (!isBack && !isForward) return;
    event.preventDefault();
    const grid = current.closest('.grid');
    const mains = [...grid.querySelectorAll('.tile-main')];
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    const step = (vertical ? columns : 1) * (isBack ? -1 : 1);
    const next = mains[mains.indexOf(current) + step];
    if (next) next.focus();
    else if (event.key === 'ArrowUp') search.focus();
  });

  return { render, focus: () => search.focus() };
}
