import { vi } from "vitest";

export type InvokeHandler = (args: Record<string, unknown>) => unknown;

const handlers = new Map<string, InvokeHandler>();

export const invoke = vi.fn(
  async <T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    const handler = handlers.get(cmd);
    if (!handler) {
      throw new Error(`No mock handler for invoke("${cmd}")`);
    }
    return (await handler(args ?? {})) as T;
  },
);

export const convertFileSrc = vi.fn(
  (filePath: string, protocol = "asset") => `${protocol}://localhost/${filePath}`,
);

export function setInvokeHandler(cmd: string, handler: InvokeHandler) {
  handlers.set(cmd, handler);
}

export function clearInvokeHandlers() {
  handlers.clear();
  invoke.mockClear();
  convertFileSrc.mockClear();
}
