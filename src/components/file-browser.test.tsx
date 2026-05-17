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
  // Default: no pipeline config anywhere. Per-test setups override.
  setInvokeHandler("local_read_text_file", () => null);
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

describe("FileBrowser — local pipeline detection", () => {
  function setupConfigAt(
    configsByDir: Record<string, string | null>,
  ) {
    setInvokeHandler("local_read_text_file", (args) => {
      const path = (args as { path: string }).path;
      // The source asks for `<dir>/.dropbox-interface.json`.
      const dir = path.replace(/[/\\]\.dropbox-interface\.json$/, "");
      const v = configsByDir[dir];
      return v ?? null;
    });
  }

  const validConfig = JSON.stringify({
    version: 1,
    kind: "pipeline",
    name: "Local review",
    states: [
      { id: "processing", folder: "1__Processing", name: "Processing" },
      { id: "ready", folder: "2__ready", name: "Ready" },
    ],
  });

  it("renders the flat browser when no config is present", async () => {
    setupFs({
      "/home/user": [
        { name: "loose.txt", path: "/home/user/loose.txt", isDirectory: false },
      ],
    });
    render(<FileBrowser />);
    expect(await screen.findByText("loose.txt")).toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: /pipeline buckets/i }),
    ).not.toBeInTheDocument();
  });

  it("switches to PipelineView when a valid config is present", async () => {
    setupFs({
      "/home/user": [
        {
          name: "1__Processing",
          path: "/home/user/1__Processing",
          isDirectory: true,
        },
        {
          name: "2__ready",
          path: "/home/user/2__ready",
          isDirectory: true,
        },
        { name: "loose.txt", path: "/home/user/loose.txt", isDirectory: false },
      ],
    });
    setupConfigAt({ "/home/user": validConfig });

    render(<FileBrowser />);
    // The pipeline tab strip appears, with Inbox + the two states.
    const tablist = await screen.findByRole("tablist", {
      name: /pipeline buckets/i,
    });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Inbox/i),
        expect.stringMatching(/Processing/i),
        expect.stringMatching(/Ready/i),
      ]),
    );
    // The loose file shows as an Inbox item (Inbox is the default tab).
    expect(screen.getByText("loose.txt")).toBeInTheDocument();
  });

  it("shows an issues banner and stays on the flat browser for an invalid config", async () => {
    setupFs({
      "/home/user": [
        { name: "loose.txt", path: "/home/user/loose.txt", isDirectory: false },
      ],
    });
    // Missing `kind`, missing `states` — multi-issue.
    setupConfigAt({
      "/home/user": JSON.stringify({ version: 1 }),
    });

    render(<FileBrowser />);
    expect(await screen.findByText(/falling back to flat view/i))
      .toBeInTheDocument();
    // Flat row still renders.
    expect(screen.getByText("loose.txt")).toBeInTheDocument();
    // No pipeline strip.
    expect(
      screen.queryByRole("tablist", { name: /pipeline buckets/i }),
    ).not.toBeInTheDocument();
  });

  it("switches between list and tile view via the toggle, persisting the choice", async () => {
    setupFs({
      "/home/user": [
        { name: "Pictures", path: "/home/user/Pictures", isDirectory: true },
        { name: "shot.jpg", path: "/home/user/shot.jpg", isDirectory: false },
      ],
    });
    localStorage.removeItem("dropbox-interface:browser-view-mode:v1");
    const user = userEvent.setup();
    render(<FileBrowser />);

    // Default is list — clicking the folder works through the list button.
    await screen.findByText("Pictures");
    expect(
      screen.getByRole("button", { name: /list view/i }),
    ).toHaveAttribute("aria-pressed", "true");

    // Flip to tile.
    await user.click(screen.getByRole("button", { name: /tile view/i }));
    // Tile-mode buttons read "Open folder X" / "Preview X".
    expect(
      screen.getByRole("button", { name: /open folder pictures/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview shot\.jpg/i }),
    ).toBeInTheDocument();

    // Preference persists.
    const raw = localStorage.getItem(
      "dropbox-interface:browser-view-mode:v1",
    );
    expect(JSON.parse(raw as string)).toEqual({ files: "tile" });
  });

  it("recovers to the flat browser after navigating out of a pipeline folder", async () => {
    setupFs({
      "/home/user": [
        {
          name: "review",
          path: "/home/user/review",
          isDirectory: true,
        },
        { name: "other.txt", path: "/home/user/other.txt", isDirectory: false },
      ],
      "/home/user/review": [
        {
          name: "1__Processing",
          path: "/home/user/review/1__Processing",
          isDirectory: true,
        },
      ],
    });
    setupConfigAt({ "/home/user/review": validConfig });

    const user = userEvent.setup();
    render(<FileBrowser />);
    // Start at root → flat view; navigate into review/ → pipeline.
    await screen.findByText("review");
    await user.click(screen.getByRole("button", { name: "review" }));
    await screen.findByRole("tablist", { name: /pipeline buckets/i });

    // Navigate back up → pipeline detection resets, flat browser returns.
    await user.click(screen.getByRole("button", { name: /parent folder/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole("tablist", { name: /pipeline buckets/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("other.txt")).toBeInTheDocument();
  });
});
