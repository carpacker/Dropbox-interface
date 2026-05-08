import { vi } from "vitest";

export type UnlistenFn = () => void;
export type EventCallback<T> = (event: { payload: T }) => void;

type Listener = { event: string; cb: EventCallback<unknown> };

const listeners = new Set<Listener>();

export const listen = vi.fn(
  async <T>(event: string, cb: EventCallback<T>): Promise<UnlistenFn> => {
    const entry: Listener = { event, cb: cb as EventCallback<unknown> };
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  },
);

export function emitMockEvent<T>(event: string, payload: T) {
  for (const l of listeners) {
    if (l.event === event) {
      l.cb({ payload });
    }
  }
}

export function clearMockListeners() {
  listeners.clear();
  listen.mockClear();
}
