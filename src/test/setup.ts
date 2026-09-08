import '@testing-library/jest-dom/vitest'

/**
 * ROUND 24 (Q6). This setup runs for EVERY test file, including the ones that
 * deliberately opt out of jsdom.
 *
 * The SQLite-backed suites — Fresh Start, the operator path, the programme
 * store and the three migration suites — import `node:sqlite`, which Vite
 * refuses to bundle for the client environment. They therefore declare
 * `// @vitest-environment node`, where there is no `window` at all, and this
 * file used to throw `ReferenceError: window is not defined` before a single
 * test could run.
 *
 * So the DOM shims are applied only where there is a DOM. Nothing about the
 * jsdom suites changes: the same shims, on the same objects, under the same
 * conditions.
 */
if (typeof window !== 'undefined') {
  // jsdom lacks a few browser APIs that Motion/Vaul touch.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = window.ResizeObserver ?? ResizeObserverStub
  window.HTMLElement.prototype.setPointerCapture =
    window.HTMLElement.prototype.setPointerCapture ?? (() => {})
  window.HTMLElement.prototype.releasePointerCapture =
    window.HTMLElement.prototype.releasePointerCapture ?? (() => {})
  window.HTMLElement.prototype.scrollIntoView =
    window.HTMLElement.prototype.scrollIntoView ?? (() => {})

  // jsdom lacks matchMedia; Motion + reduced-motion checks need it.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
