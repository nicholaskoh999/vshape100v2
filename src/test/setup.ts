import '@testing-library/jest-dom/vitest'

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
