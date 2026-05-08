import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import {
  setNextSaveError,
  setNextSavePath,
} from "@/test/tauri-dialog-mock";
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

    const folderBtn = await screen.findByRole("button", {
      name: /open folder photos/i,
    });
    expect(folderBtn).not.toBeDisabled();
    const fileBtn = screen.getByRole("button", { name: /^todo\.txt$/i });
    expect(fileBtn).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /save todo\.txt to disk/i }),
    ).not.toBeDisabled();
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

    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    const user = userEvent.setup();
    render(<DropboxApp />);
    await user.click(
      await screen.findByRole("button", { name: /open folder photos/i }),
    );

    expect(await screen.findByText("/photos")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /preview vacation\.png/i }),
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

    await screen.findByRole("button", { name: /open folder photos/i });
    const parentBtn = screen.getByRole("button", { name: /parent folder/i });
    expect(parentBtn).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /open folder photos/i }));
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

describe("DropboxApp — image preview + save", () => {
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

  const imageEntry = {
    kind: "file" as const,
    name: "sunset.jpg",
    path: "/photos/sunset.jpg",
    displayPath: "/Photos/sunset.jpg",
    size: 1024,
    serverModified: "2025-01-02T03:04:05Z",
  };

  it("renders an inline thumbnail for image files once it loads", async () => {
    setupConnected({ "": [imageEntry] });
    setInvokeHandler("dropbox_get_thumbnail", (args) => {
      expect(args).toMatchObject({
        path: "/photos/sunset.jpg",
        size: "w64h64",
      });
      return "data:image/jpeg;base64,ZmFrZQ==";
    });

    render(<DropboxApp />);
    const img = (await screen.findByTestId(
      `thumbnail-/photos/sunset.jpg`,
    )) as HTMLImageElement;
    expect(img.src).toBe("data:image/jpeg;base64,ZmFrZQ==");
  });

  it("falls back to the file icon when thumbnail fetch fails", async () => {
    setupConnected({ "": [imageEntry] });
    setInvokeHandler("dropbox_get_thumbnail", () => {
      throw new Error("not_image_content");
    });

    render(<DropboxApp />);
    // The image button must be present, but no thumbnail testid should appear
    expect(
      await screen.findByRole("button", { name: /preview sunset\.jpg/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByTestId("thumbnail-/photos/sunset.jpg"),
      ).not.toBeInTheDocument(),
    );
  });

  it("clicking an image opens the preview lightbox with an asset URL", async () => {
    setupConnected({ "": [imageEntry] });
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_download_to_temp", (args) => {
      expect(args).toMatchObject({ path: "/photos/sunset.jpg" });
      return "/tmp/preview/sunset.jpg";
    });

    const user = userEvent.setup();
    render(<DropboxApp />);
    await user.click(
      await screen.findByRole("button", { name: /preview sunset\.jpg/i }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: /preview sunset\.jpg/i,
    });
    const img = await waitFor(() =>
      dialog.querySelector("img") as HTMLImageElement,
    );
    expect(img).not.toBeNull();
    expect(img.src.startsWith("asset://")).toBe(true);
    expect(img.src).toContain("sunset.jpg");
  });

  it("Escape closes the preview lightbox", async () => {
    setupConnected({ "": [imageEntry] });
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_download_to_temp", () => "/tmp/preview/x.jpg");

    const user = userEvent.setup();
    render(<DropboxApp />);
    await user.click(
      await screen.findByRole("button", { name: /preview sunset\.jpg/i }),
    );
    await screen.findByRole("dialog", { name: /preview sunset\.jpg/i });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /preview sunset\.jpg/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("surfaces a download error inside the lightbox", async () => {
    setupConnected({ "": [imageEntry] });
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_download_to_temp", () => {
      throw new Error("dropbox returned an error: 409 path/not_found");
    });

    const user = userEvent.setup();
    render(<DropboxApp />);
    await user.click(
      await screen.findByRole("button", { name: /preview sunset\.jpg/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /preview sunset\.jpg/i,
    });
    await waitFor(() =>
      expect(dialog).toHaveTextContent(/path\/not_found/),
    );
  });

  it("Save button opens the save dialog and writes via dropbox_save_file_to", async () => {
    const fileEntry = {
      kind: "file" as const,
      name: "report.pdf",
      path: "/reports/report.pdf",
      displayPath: "/reports/report.pdf",
      size: 99,
      serverModified: null,
    };
    setupConnected({ "": [fileEntry] });
    setNextSavePath("/home/user/report.pdf");
    const saveSpy = vi.fn((args: unknown) => {
      expect(args).toMatchObject({
        path: "/reports/report.pdf",
        dest: "/home/user/report.pdf",
      });
      return 99;
    });
    setInvokeHandler("dropbox_save_file_to", saveSpy);

    const user = userEvent.setup();
    render(<DropboxApp />);
    await user.click(
      await screen.findByRole("button", {
        name: /save report\.pdf to disk/i,
      }),
    );

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Saved [^]*report\.pdf[^]*\/home\/user\/report\.pdf/),
    ).toBeInTheDocument();
  });

  it("Save is a no-op when the user cancels the save dialog", async () => {
    const fileEntry = {
      kind: "file" as const,
      name: "report.pdf",
      path: "/reports/report.pdf",
      displayPath: "/reports/report.pdf",
      size: 99,
      serverModified: null,
    };
    setupConnected({ "": [fileEntry] });
    setNextSavePath(null); // user cancels
    const saveSpy = vi.fn(() => 0);
    setInvokeHandler("dropbox_save_file_to", saveSpy);

    const user = userEvent.setup();
    render(<DropboxApp />);
    await user.click(
      await screen.findByRole("button", { name: /save report\.pdf to disk/i }),
    );
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("surfaces save dialog errors as alerts", async () => {
    const fileEntry = {
      kind: "file" as const,
      name: "x.bin",
      path: "/x.bin",
      displayPath: "/x.bin",
      size: 1,
      serverModified: null,
    };
    setupConnected({ "": [fileEntry] });
    setNextSaveError("dialog plugin failed");

    const user = userEvent.setup();
    render(<DropboxApp />);
    await user.click(
      await screen.findByRole("button", { name: /save x\.bin to disk/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/dialog plugin failed/);
  });

  it("non-image, non-folder rows have a disabled main button", async () => {
    const fileEntry = {
      kind: "file" as const,
      name: "data.csv",
      path: "/data.csv",
      displayPath: "/data.csv",
      size: 100,
      serverModified: null,
    };
    setupConnected({ "": [fileEntry] });

    render(<DropboxApp />);
    const main = await screen.findByRole("button", { name: /^data\.csv$/i });
    expect(main).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /save data\.csv to disk/i }),
    ).not.toBeDisabled();
  });

  it("folders do not render a Save button", async () => {
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
    });
    render(<DropboxApp />);
    await screen.findByRole("button", { name: /open folder photos/i });
    expect(
      screen.queryByRole("button", { name: /save photos to disk/i }),
    ).not.toBeInTheDocument();
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
