import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import { DropboxApp } from "./dropbox-app";

beforeEach(() => {
  vi.stubEnv("VITE_DROPBOX_APP_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DropboxApp — env / configuration", () => {
  it("shows a setup prompt when the app key env var is missing", async () => {
    vi.stubEnv("VITE_DROPBOX_APP_KEY", "");
    render(<DropboxApp />);
    expect(
      await screen.findByText(/dropbox app key missing/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/VITE_DROPBOX_APP_KEY/)).toBeInTheDocument();
  });
});

describe("DropboxApp — disconnected", () => {
  it("renders the connect button when status returns null", async () => {
    setInvokeHandler("dropbox_status", () => null);
    render(<DropboxApp />);
    expect(
      await screen.findByRole("button", { name: /connect dropbox/i }),
    ).toBeInTheDocument();
  });

  it("clicking Connect runs the OAuth flow and shows the remote browser", async () => {
    setInvokeHandler("dropbox_status", () => null);
    setInvokeHandler("dropbox_connect", () => ({
      accountId: "dbid:1",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    }));
    setInvokeHandler("dropbox_list_folder", (args) => {
      expect(args).toMatchObject({ path: "" });
      return [];
    });

    const user = userEvent.setup();
    render(<DropboxApp />);

    await user.click(
      await screen.findByRole("button", { name: /connect dropbox/i }),
    );
    expect(
      await screen.findByText(/Dropbox · Ada Lovelace/i),
    ).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(await screen.findByText(/this folder is empty/i)).toBeInTheDocument();
  });

  it("surfaces a connect error", async () => {
    setInvokeHandler("dropbox_status", () => null);
    setInvokeHandler("dropbox_connect", () => {
      throw new Error("user closed the browser");
    });

    const user = userEvent.setup();
    render(<DropboxApp />);
    await user.click(
      await screen.findByRole("button", { name: /connect dropbox/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/user closed/i);
  });
});

describe("DropboxApp — connected: RemoteBrowser", () => {
  function setupConnected(
    listings: Record<string, unknown[]>,
    account = {
      accountId: "dbid:1",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    },
  ) {
    setInvokeHandler("dropbox_status", () => account);
    setInvokeHandler("dropbox_list_folder", (args) => {
      const path = (args as { path: string }).path;
      const rows = listings[path];
      if (!rows) throw new Error(`no listing for ${path}`);
      return rows;
    });
  }

  it("loads the root listing and renders entries with files disabled", async () => {
    setupConnected({
      "": [
        {
          kind: "folder",
          name: "Photos",
          path: "/photos",
          displayPath: "/Photos",
          size: null,
          serverModified: null,
        },
        {
          kind: "file",
          name: "todo.txt",
          path: "/todo.txt",
          displayPath: "/todo.txt",
          size: 12,
          serverModified: "2025-01-02T03:04:05Z",
        },
      ],
    });

    render(<DropboxApp />);
    expect(await screen.findByText(/^\/ \(root\)$/)).toBeInTheDocument();

    const folderBtn = await screen.findByRole("button", { name: /photos/i });
    expect(folderBtn).not.toBeDisabled();
    const fileBtn = screen.getByRole("button", { name: /todo\.txt/i });
    expect(fileBtn).toBeDisabled();
  });

  it("clicking a folder navigates into it", async () => {
    setupConnected({
      "": [
        {
          kind: "folder",
          name: "Photos",
          path: "/photos",
          displayPath: "/Photos",
          size: null,
          serverModified: null,
        },
      ],
      "/photos": [
        {
          kind: "file",
          name: "vacation.png",
          path: "/photos/vacation.png",
          displayPath: "/Photos/vacation.png",
          size: 1024,
          serverModified: "2025-01-02T03:04:05Z",
        },
      ],
    });

    const user = userEvent.setup();
    render(<DropboxApp />);
    await user.click(await screen.findByRole("button", { name: /photos/i }));

    expect(await screen.findByText("/photos")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /vacation\.png/i }),
    ).toBeInTheDocument();
  });

  it("parent button is disabled at root and walks up otherwise", async () => {
    setupConnected({
      "": [
        {
          kind: "folder",
          name: "Photos",
          path: "/photos",
          displayPath: "/Photos",
          size: null,
          serverModified: null,
        },
      ],
      "/photos": [],
    });

    const user = userEvent.setup();
    render(<DropboxApp />);

    await screen.findByRole("button", { name: /photos/i });
    const parentBtn = screen.getByRole("button", { name: /parent folder/i });
    expect(parentBtn).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /photos/i }));
    await screen.findByText("/photos");

    const parentBtnAfter = screen.getByRole("button", { name: /parent folder/i });
    expect(parentBtnAfter).not.toBeDisabled();
    await user.click(parentBtnAfter);
    expect(await screen.findByText(/^\/ \(root\)$/)).toBeInTheDocument();
  });

  it("disconnect calls dropbox_disconnect and returns to the connect screen", async () => {
    setupConnected({ "": [] });
    const disconnectSpy = vi.fn(() => undefined);
    setInvokeHandler("dropbox_disconnect", disconnectSpy);

    const user = userEvent.setup();
    render(<DropboxApp />);

    await screen.findByText(/Dropbox · Ada Lovelace/i);
    await user.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("button", { name: /connect dropbox/i }),
    ).toBeInTheDocument();
  });

  it("surfaces list_folder errors in an alert", async () => {
    setInvokeHandler("dropbox_status", () => ({
      accountId: "dbid:1",
      displayName: "Ada",
      email: "a@b",
    }));
    setInvokeHandler("dropbox_list_folder", () => {
      throw new Error("dropbox returned an error: 409 path/not_found");
    });

    render(<DropboxApp />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/path\/not_found/);
  });
});

describe("DropboxApp — error and recovery", () => {
  it("surfaces a status error and lets the user retry", async () => {
    let calls = 0;
    setInvokeHandler("dropbox_status", () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("network down");
      }
      return null;
    });

    const user = userEvent.setup();
    render(<DropboxApp />);

    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /connect dropbox/i }),
      ).toBeInTheDocument(),
    );
  });
});
