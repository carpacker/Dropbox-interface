import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { clearInvokeHandlers } from "./tauri-core-mock";
import { clearMockListeners } from "./tauri-event-mock";

export function resetTauriMock() {
  clearInvokeHandlers();
  clearMockListeners();
}

afterEach(() => {
  cleanup();
  resetTauriMock();
  localStorage.clear();
});

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

if (typeof globalThis.ResizeObserver === "undefined") {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    StubResizeObserver as unknown as typeof ResizeObserver;
}
