const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an element. Text goes through DOM nodes, so bookmark titles can't inject markup. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key.startsWith('aria-') || key.startsWith('data-')) el.setAttribute(key, value);
    else el[key] = value;
  }
  el.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return el;
}

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function favicon(url, size = 32) {
  const src = new URL(chrome.runtime.getURL('/_favicon/'));
  src.searchParams.set('pageUrl', url);
  src.searchParams.set('size', String(size));
  return h('img', { class: 'favicon', src: src.href, alt: '', loading: 'lazy', width: 16, height: 16 });
}

/** A row for a checklist: a checkbox plus title and detail line, all inside one label. */
export function checkRow({ url, title, meta, tag, checked, onChange }) {
  return h(
    'label',
    { class: 'check-row' },
    h('input', { type: 'checkbox', checked, onchange: (event) => onChange(event.target.checked) }),
    favicon(url),
    h(
      'span',
      { class: 'row-text' },
      h('span', { class: 'title', title }, title || url),
      h('span', { class: 'meta', title: meta }, meta),
    ),
    tag ? h('span', { class: 'tag' }, tag) : null,
  );
}
