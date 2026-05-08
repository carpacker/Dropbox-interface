import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import { FileBrowser } from "./file-browser";

type Entry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number | null;
  modified?: number | null;
};

function setupFs(map: Record<string, Entry[]>, root = "/home/user") {
  setInvokeHandler("default_local_root", () => root);
  setInvokeHandler("list_directory", (args) => {
    const path = (args as { path: string }).path;
    const rows = map[path];
    if (!rows) {
      throw new Error(`Not a directory: ${path}`);
    }
    return rows;
  });
  setInvokeHandler("parent_directory", (args) => {
    const path = (args as { path: string }).path;
    const idx = path.lastIndexOf("/");
    if (idx <= 0) return null;
    return path.slice(0, idx);
  });
}

describe("FileBrowser", () => {
  it("loads the default root and lists entries", async () => {
    setupFs({
      "/home/user": [
        { name: "Pictures", path: "/home/user/Pictures", isDirectory: true },
        { name: "notes.txt", path: "/home/user/notes.txt", isDirectory: false },
      ],
    });

    render(<FileBrowser />);

    expect(await screen.findByText("Pictures")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    const input = screen.getByLabelText("Folder path") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("/home/user"));
  });

  it("shows empty-state message when folder has no entries", async () => {
    setupFs({ "/home/user": [] });
    render(<FileBrowser />);
    expect(await screen.findByText(/this folder is empty/i)).toBeInTheDocument();
  });

  it("surfaces errors from list_directory", async () => {
    setInvokeHandler("default_local_root", () => "/home/user");
    setInvokeHandler("list_directory", () => {
      throw new Error("permission denied");
    });
    render(<FileBrowser />);
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument();
  });

  it("clicking a folder loads its contents", async () => {
    setupFs({
      "/home/user": [
        { name: "Pictures", path: "/home/user/Pictures", isDirectory: true },
      ],
      "/home/user/Pictures": [
        { name: "vacation.png", path: "/home/user/Pictures/vacation.png", isDirectory: false },
      ],
    });

    const user = userEvent.setup();
    render(<FileBrowser />);

    await user.click(await screen.findByRole("button", { name: /pictures/i }));
    expect(await screen.findByText("vacation.png")).toBeInTheDocument();
  });

  it("file entries are disabled (cannot navigate into a file)", async () => {
    setupFs({
      "/home/user": [
        { name: "notes.txt", path: "/home/user/notes.txt", isDirectory: false },
      ],
    });
    render(<FileBrowser />);
    const fileBtn = await screen.findByRole("button", { name: /notes\.txt/i });
    expect(fileBtn).toBeDisabled();
  });

  it("Go submits the typed path", async () => {
    setupFs({
      "/home/user": [],
      "/tmp": [
        { name: "scratch", path: "/tmp/scratch", isDirectory: true },
      ],
    });

    const user = userEvent.setup();
    render(<FileBrowser />);

    await screen.findByText(/this folder is empty/i);

    const input = screen.getByLabelText("Folder path");
    await user.clear(input);
    await user.type(input, "/tmp");
    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(await screen.findByText("scratch")).toBeInTheDocument();
  });

  it("parent button navigates up", async () => {
    setupFs({
      "/home/user": [
        { name: "Pictures", path: "/home/user/Pictures", isDirectory: true },
      ],
      "/home/user/Pictures": [],
      "/home": [{ name: "user", path: "/home/user", isDirectory: true }],
    });

    const user = userEvent.setup();
    render(<FileBrowser />);

    await user.click(await screen.findByRole("button", { name: /pictures/i }));
    await screen.findByText(/this folder is empty/i);

    await user.click(screen.getByRole("button", { name: /parent folder/i }));
    expect(await screen.findByText("Pictures")).toBeInTheDocument();
  });

  it("refresh re-fetches the current directory", async () => {
    const handler = vi.fn((args: unknown) => {
      const path = (args as { path: string }).path;
      if (path === "/home/user") {
        return [
          { name: "a", path: "/home/user/a", isDirectory: true },
        ];
      }
      throw new Error("unexpected path");
    });
    setInvokeHandler("default_local_root", () => "/home/user");
    setInvokeHandler("list_directory", handler);

    const user = userEvent.setup();
    render(<FileBrowser />);

    await screen.findByText("a");
    const callsBefore = handler.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /refresh listing/i }));
    await waitFor(() =>
      expect(handler.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it("surfaces failure of default_local_root", async () => {
    setInvokeHandler("default_local_root", () => {
      throw new Error("HOME is not set");
    });
    render(<FileBrowser />);
    expect(await screen.findByText(/home is not set/i)).toBeInTheDocument();
  });

  it("disables nav controls when there is no current path", () => {
    setInvokeHandler("default_local_root", () => {
      throw new Error("HOME is not set");
    });
    render(<FileBrowser />);
    const region = screen.getByLabelText("Folder path").closest("form")!;
    expect(
      within(region).getByRole("button", { name: /parent folder/i }),
    ).toBeDisabled();
    expect(
      within(region).getByRole("button", { name: /refresh listing/i }),
    ).toBeDisabled();
  });

  it("renders size + relative-time metadata next to file names when available", async () => {
    setupFs({
      "/home/user": [
        { name: "Sub", path: "/home/user/Sub", isDirectory: true },
        {
          name: "doc.txt",
          path: "/home/user/doc.txt",
          isDirectory: false,
          size: 2048,
          modified: Math.floor(Date.now() / 1000) - 60 * 60, // 1h ago
        },
      ],
    });
    render(<FileBrowser />);

    const docRow = await screen.findByRole("button", { name: /doc\.txt/i });
    expect(docRow).toHaveTextContent("2.0 KB");
    expect(docRow).toHaveTextContent(/1h ago/);

    // Folder doesn't get a size badge.
    const subRow = await screen.findByRole("button", { name: /^sub$/i });
    expect(subRow).not.toHaveTextContent(/KB|MB|B/);
  });

  it("shows the SortDropdown and persists the user's choice", async () => {
    setupFs({ "/home/user": [] });
    const user = userEvent.setup();
    render(<FileBrowser />);

    // Toggle direction via the ascending → descending button.
    await screen.findByText(/this folder is empty/i);
    await user.click(
      screen.getByRole("button", { name: /sort ascending/i }),
    );
    const stored = JSON.parse(
      localStorage.getItem("dropbox-interface:sort-preference-v1")!,
    );
    expect(stored).toEqual({ key: "name", direction: "desc" });
  });
});
