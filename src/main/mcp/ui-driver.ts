/**
 * Drives the app's own window for an AI client: look at it (screenshot or a text outline of what can be clicked),
 * click and type with real input events, or run a script in the page. This replaces a screen-controlling "desktop" MCP:
 * it works on the window directly, so it keeps working when the window is behind others or on another monitor.
 *
 * `UiBridge` is the thin Electron side (see electron-ui.ts); everything else here is plain logic that tests can run.
 */

export interface UiBridge {
  /** PNG of the window contents as base64, scaled down to at most `maxWidth` pixels wide. */
  capture(maxWidth: number): Promise<{ data: string; width: number; height: number }>
  /** Runs a script in the page and returns its (structured-clone) result. */
  evaluate(code: string): Promise<unknown>
  /** A real mouse click at viewport coordinates (CSS pixels). */
  click(x: number, y: number, opts: { button: 'left' | 'right'; count: number }): Promise<void>
  /** A real key press. `key` is an Electron key code such as "Enter", "Tab", "a". */
  key(key: string, modifiers: string[]): Promise<void>
  /** Types text into the focused element as the user would. */
  insertText(text: string): Promise<void>
}

export interface ElementQuery {
  index?: number
  selector?: string
  text?: string
  exact?: boolean
  nth?: number
}

export interface Located {
  x: number
  y: number
  tag: string
  label: string
}

/** Finds elements the user could click: native controls, ARIA roles, and anything showing a pointer cursor. */
const COLLECT = `
  const SEL = 'a[href],button,input,select,textarea,summary,label[for],[role=button],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[role=link],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  // Snapshots list what is on screen; lookups for a click may also find things further down a scrollable page (they are scrolled into view).
  let onScreenOnly = true;
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (onScreenOnly && (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth)) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return null;
    return r;
  };
  const labelOf = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || el.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim();
    return t.length > 90 ? t.slice(0, 90) + '…' : t;
  };
  const collect = () => {
    const out = [];
    const seen = new Set();
    const add = (el) => { if (!seen.has(el) && rectOf(el)) { seen.add(el); out.push(el); } };
    document.querySelectorAll(SEL).forEach(add);
    // Custom controls (a div with onClick) are found by their pointer cursor; only the outermost one of a nested group counts.
    const all = document.body.querySelectorAll('*');
    for (let i = 0; i < all.length && i < 6000; i++) {
      const el = all[i];
      if (seen.has(el)) continue;
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      const p = el.parentElement;
      if (p && getComputedStyle(p).cursor === 'pointer') continue;
      add(el);
    }
    return out;
  };
`

export const SNAPSHOT_SCRIPT = `(() => {
  ${COLLECT}
  const els = collect().slice(0, 400);
  window.__madsMcpEls = els;
  return {
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    text: (document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 8000),
    elements: els.map((el, index) => {
      const r = el.getBoundingClientRect();
      const o = { index, tag: el.tagName.toLowerCase(), label: labelOf(el), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      if (el.id) o.id = el.id;
      if (el.type && el.tagName !== 'BUTTON') o.type = el.type;
      if ('value' in el && el.value !== '' && el.type !== 'password') o.value = String(el.value).slice(0, 120);
      if (el.disabled) o.disabled = true;
      if (el.checked) o.checked = true;
      if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current')) o.current = true;
      return o;
    })
  };
})()`

export function locateScript(q: ElementQuery): string {
  return `((q) => {
  ${COLLECT}
  onScreenOnly = false;
  const nth = q.nth || 0;
  let el = null;
  if (typeof q.index === 'number') {
    el = (window.__madsMcpEls || [])[q.index];
    if (!el || !el.isConnected) return { error: 'That element is gone. Take a new ui_snapshot and use its fresh index.' };
  } else if (q.selector) {
    let list;
    try { list = [...document.querySelectorAll(q.selector)].filter(rectOf); } catch (e) { return { error: 'Bad selector: ' + e.message }; }
    el = list[nth];
    if (!el) return { error: 'No visible element matches selector ' + q.selector + (list.length ? ' at nth=' + nth + ' (only ' + list.length + ' match)' : '') };
  } else if (q.text) {
    const want = q.text.toLowerCase().trim();
    const scored = collect().map((e) => ({ e, l: labelOf(e).toLowerCase() })).filter((c) => c.l && (q.exact ? c.l === want : c.l.includes(want)));
    // The exact label wins over a longer one that merely contains it; then the tightest label.
    scored.sort((a, b) => (b.l === want) - (a.l === want) || a.l.length - b.l.length);
    el = (scored[nth] || {}).e;
    if (!el) return { error: 'Nothing clickable is labelled "' + q.text + '". Call ui_snapshot to see what is on screen.' };
  } else {
    return { error: 'Give index, selector or text.' };
  }
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName.toLowerCase(), label: labelOf(el) };
})(${JSON.stringify(q)})`
}

export async function locate(ui: UiBridge, q: ElementQuery): Promise<Located> {
  const r = (await ui.evaluate(locateScript(q))) as (Located & { error?: string }) | null
  if (!r || typeof r !== 'object') throw new Error('The window did not answer.')
  if (r.error) throw new Error(r.error)
  return r
}

export async function clickElement(ui: UiBridge, q: ElementQuery, opts: { button?: 'left' | 'right'; double?: boolean } = {}): Promise<Located> {
  const at = await locate(ui, q)
  await ui.click(at.x, at.y, { button: opts.button ?? 'left', count: opts.double ? 2 : 1 })
  return at
}

/** Clicks the target (when given) so it has focus, optionally empties it, then types. */
export async function typeInto(ui: UiBridge, text: string, target: ElementQuery | null, opts: { clear?: boolean; submit?: boolean } = {}): Promise<Located | null> {
  const at = target ? await clickElement(ui, target) : null
  if (opts.clear) {
    await ui.key('a', ['control'])
    await ui.key('Backspace', [])
  }
  if (text) await ui.insertText(text)
  if (opts.submit) await ui.key('Enter', [])
  return at
}

const OUTPUT_LIMIT = 60_000

export function formatValue(v: unknown): string {
  const s = v === undefined ? 'undefined' : typeof v === 'string' ? v : JSON.stringify(v, null, 1)
  return s.length > OUTPUT_LIMIT ? `${s.slice(0, OUTPUT_LIMIT)}\n… (cut: ${s.length - OUTPUT_LIMIT} more characters)` : s
}
