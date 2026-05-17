import { vi } from "vitest";

export type SaveDialogOptions = {
  defaultPath?: string;
  title?: string;
  filters?: ReadonlyArray<{ name: string; extensions: string[] }>;
};

export type OpenDialogOptions = {
  directory?: boolean;
  multiple?: boolean;
  defaultPath?: string;
  title?: string;
  filters?: ReadonlyArray<{ name: string; extensions: string[] }>;
};

let nextSavePath: string | null | "throw" = null;
let nextThrowMessage = "user closed dialog";

let nextOpenResult: string | string[] | null | "throw" = null;
let nextOpenThrowMessage = "user closed dialog";

export function setNextSavePath(value: string | null) {
  nextSavePath = value;
}

export function setNextSaveError(message: string) {
  nextSavePath = "throw";
  nextThrowMessage = message;
}

export function setNextOpenResult(value: string | string[] | null) {
  nextOpenResult = value;
}

export function setNextOpenError(message: string) {
  nextOpenResult = "throw";
  nextOpenThrowMessage = message;
}

export const save = vi.fn(
  async (_opts?: SaveDialogOptions): Promise<string | null> => {
    if (nextSavePath === "throw") {
      throw new Error(nextThrowMessage);
    }
    return nextSavePath;
  },
);

export const open = vi.fn(
  async (
    _opts?: OpenDialogOptions,
  ): Promise<string | string[] | null> => {
    if (nextOpenResult === "throw") {
      throw new Error(nextOpenThrowMessage);
    }
    return nextOpenResult;
  },
);

export function clearDialogMock() {
  nextSavePath = null;
  nextThrowMessage = "user closed dialog";
  nextOpenResult = null;
  nextOpenThrowMessage = "user closed dialog";
  save.mockClear();
  open.mockClear();
}
