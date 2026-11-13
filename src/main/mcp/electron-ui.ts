import type { BrowserWindow } from 'electron'
import type { UiBridge } from './ui-driver'

type Modifier = 'shift' | 'control' | 'alt' | 'meta'
const MODIFIERS = new Set<string>(['shift', 'control', 'alt', 'meta'])

/** The Electron side of `UiBridge`: real input events sent straight to the window's web contents. */
export function electronUi(getWindow: () => BrowserWindow | undefined): UiBridge {
  const wc = () => {
    const w = getWindow()
    if (!w || w.isDestroyed()) throw new Error('The app window is not open.')
    return w.webContents
  }
  const mods = (list: string[]): Modifier[] => list.map((m) => m.toLowerCase()).filter((m): m is Modifier => MODIFIERS.has(m))

  return {
    async capture(maxWidth) {
      const w = getWindow()
      if (!w || w.isDestroyed()) throw new Error('The app window is not open.')
      if (w.isMinimized()) w.restore() // Chromium does not paint a minimized window
      const img = await w.webContents.capturePage()
      if (img.isEmpty()) throw new Error('The window produced no image (it may still be loading).')
      const { width } = img.getSize()
      const out = width > maxWidth ? img.resize({ width: maxWidth, quality: 'good' }) : img
      const size = out.getSize()
      return { data: out.toPNG().toString('base64'), width: size.width, height: size.height }
    },
    evaluate: (code) => wc().executeJavaScript(code, true),
    async click(x, y, { button, count }) {
      const c = wc()
      c.focus()
      c.sendInputEvent({ type: 'mouseMove', x, y })
      for (let i = 1; i <= count; i++) {
        c.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: i })
        c.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: i })
      }
    },
    async key(key, modifiers) {
      const c = wc()
      const m = mods(modifiers)
      c.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: m })
      // A printable key with no shortcut modifier also produces text.
      if (key.length === 1 && !m.includes('control') && !m.includes('alt') && !m.includes('meta')) c.sendInputEvent({ type: 'char', keyCode: key, modifiers: m })
      c.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: m })
    },
    async insertText(text) {
      const c = wc()
      c.focus()
      await c.insertText(text)
    }
  }
}
