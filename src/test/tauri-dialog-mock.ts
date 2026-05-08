import { vi } from "vitest";

export type SaveDialogOptions = {
  defaultPath?: string;
  title?: string;
  filters?: ReadonlyArray<{ name: string; extensions: string[] }>;
};

let nextSavePath: string | null | "throw" = null;
let nextThrowMessage = "user closed dialog";

export function setNextSavePath(value: string | null) {
  nextSavePath = value;
}

export function setNextSaveError(message: string) {
  nextSavePath = "throw";
  nextThrowMessage = message;
}

export const save = vi.fn(
  async (_opts?: SaveDialogOptions): Promise<string | null> => {
    if (nextSavePath === "throw") {
      throw new Error(nextThrowMessage);
    }
    return nextSavePath;
  },
);

export function clearDialogMock() {
  nextSavePath = null;
  nextThrowMessage = "user closed dialog";
  save.mockClear();
}
