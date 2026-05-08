import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultShellId,
  isLikelyWindows,
  loadTerminalShellId,
  saveTerminalShellId,
  UNIX_SHELL_OPTIONS,
  WINDOWS_SHELL_OPTIONS,
} from "./terminal-preferences";

const STORAGE_KEY = "dropbox-interface:terminal-shell";

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    get: () => ua,
  });
}

describe("isLikelyWindows", () => {
  afterEach(() => setUserAgent("Mozilla/5.0 (X11; Linux x86_64)"));

  it("detects Windows user agent", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0)");
    expect(isLikelyWindows()).toBe(true);
  });

  it("returns false for non-Windows user agent", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    expect(isLikelyWindows()).toBe(false);
  });
});

describe("defaultShellId", () => {
  afterEach(() => setUserAgent("Mozilla/5.0 (X11; Linux x86_64)"));

  it("returns powershell on Windows", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0)");
    expect(defaultShellId()).toBe("powershell");
  });

  it("returns login on Unix", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux)");
    expect(defaultShellId()).toBe("login");
  });
});

describe("saveTerminalShellId / loadTerminalShellId", () => {
  beforeEach(() => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    localStorage.clear();
  });

  it("falls back to default when nothing is stored", () => {
    expect(loadTerminalShellId()).toBe("login");
  });

  it("round-trips a Unix value", () => {
    saveTerminalShellId("bash");
    expect(loadTerminalShellId()).toBe("bash");
  });

  it("normalizes legacy 'posix' to 'login' on Unix", () => {
    localStorage.setItem(STORAGE_KEY, "posix");
    expect(loadTerminalShellId()).toBe("login");
  });

  it("falls back to default if stored value is from the wrong platform", () => {
    localStorage.setItem(STORAGE_KEY, "powershell");
    expect(loadTerminalShellId()).toBe("login");
  });

  it("falls back to default when stored value is garbage", () => {
    localStorage.setItem(STORAGE_KEY, "definitely-not-a-shell");
    expect(loadTerminalShellId()).toBe("login");
  });

  it("returns Windows default when stored value is missing on Windows", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0)");
    expect(loadTerminalShellId()).toBe("powershell");
  });

  it("round-trips a Windows value", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0)");
    saveTerminalShellId("pwsh");
    expect(loadTerminalShellId()).toBe("pwsh");
  });

  it("falls back to default when localStorage.getItem throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(loadTerminalShellId()).toBe("login");
    spy.mockRestore();
  });

  it("does not throw when localStorage.setItem throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() => saveTerminalShellId("bash")).not.toThrow();
    spy.mockRestore();
  });
});

describe("shell option lists", () => {
  it("Windows option values are unique TerminalShellIds", () => {
    const values = WINDOWS_SHELL_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(["powershell", "cmd", "pwsh"]);
  });

  it("Unix option values are unique TerminalShellIds", () => {
    const values = UNIX_SHELL_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(["login", "sh", "bash"]);
  });
});
