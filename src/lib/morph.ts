// Minimal DOM morphing: patch `el` to match `html` in place, so CSS transitions
// (bar widths, word positions) animate instead of the whole slide re-rendering.
// Children carrying data-k are matched by key, others by position.

export function morph(el: Element, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(el, tpl.content);
}

function key(n: Node): string | null {
  return n instanceof Element ? n.getAttribute('data-k') : null;
}

function same(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a instanceof Element && b instanceof Element) return a.tagName === b.tagName && key(a) === key(b);
  return true;
}

function patchChildren(from: Node, to: Node): void {
  const old = [...from.childNodes];
  const next = [...to.childNodes];
  const byKey = new Map<string, Node>();
  for (const n of old) {
    const k = key(n);
    if (k) byKey.set(k, n);
  }
  const used = new Set<Node>();
  let pos = 0;
  next.forEach((n, i) => {
    const k = key(n);
    let cand: Node | undefined;
    if (k) cand = byKey.get(k);
    else {
      while (pos < old.length && (key(old[pos]) || used.has(old[pos]))) pos++;
      cand = old[pos];
    }
    let target: Node;
    if (cand && !used.has(cand) && same(cand, n)) {
      patchNode(cand, n);
      target = cand;
      if (!k) pos++;
    } else {
      target = n.cloneNode(true);
    }
    used.add(target);
    const at = from.childNodes[i];
    if (at !== target) from.insertBefore(target, at || null);
  });
  for (const n of [...from.childNodes]) if (!used.has(n)) from.removeChild(n);
}

function patchNode(a: Node, b: Node): void {
  if (a.nodeType === Node.TEXT_NODE || a.nodeType === Node.COMMENT_NODE) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  if (!(a instanceof Element) || !(b instanceof Element)) return;
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  patchChildren(a, b);
}
