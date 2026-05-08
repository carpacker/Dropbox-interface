import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import { parseConfig } from "@/lib/pipeline/schema";
import { type DropboxEntry } from "@/lib/tauri-dropbox";

import { PipelineView } from "./pipeline-view";

function configFixture(overrides: Record<string, unknown> = {}) {
  const r = parseConfig({
    version: 1,
    kind: "pipeline",
    name: "Test pipeline",
    states: [
      { id: "processing", folder: "1__Processing", name: "Processing" },
      { id: "ready", folder: "2__ready", name: "Ready" },
      { id: "published", folder: "3__published", name: "Published", terminal: true },
    ],
    ...overrides,
  });
  if (!r.ok) throw new Error("fixture failed");
  return r.config;
}

function dropboxFolder(name: string, path = `/parent/${name}`): DropboxEntry {
  return {
    kind: "folder",
    name,
    path,
    displayPath: path,
    size: null,
    serverModified: null,
  };
}
function dropboxFile(
  name: string,
  path = `/parent/${name}`,
  extra: Partial<DropboxEntry> = {},
): DropboxEntry {
  return {
    kind: "file",
    name,
    path,
    displayPath: path,
    size: 100,
    serverModified: "2025-01-02T00:00:00Z",
    ...extra,
  };
}

function setupDropboxListing(
  byPath: Record<string, DropboxEntry[]>,
) {
  setInvokeHandler("dropbox_list_folder", (args) => {
    const path = (args as { path: string }).path;
    const rows = byPath[path];
    if (!rows) throw new Error(`no listing registered for ${path}`);
    return rows;
  });
  // Thumbnail fetches end up in the EntryRow; tests may not care, so
  // return a stub data URL by default.
  setInvokeHandler(
    "dropbox_get_thumbnail",
    () => "data:image/jpeg;base64,zz",
  );
}

function renderWith(props: {
  parentPath?: string;
  parentEntries?: DropboxEntry[];
  onNavigateInto?: (path: string) => void;
  onParentRefresh?: () => void;
  onPreviewImage?: (entry: DropboxEntry) => void;
  onSaveFile?: (entry: DropboxEntry) => void;
  savingPath?: string | null;
  config?: ReturnType<typeof configFixture>;
  renderEntryRow?: React.ComponentProps<typeof PipelineView>["renderEntryRow"];
}) {
  const config = props.config ?? configFixture();
  return render(
    <PipelineView
      parentPath={props.parentPath ?? "/parent"}
      config={config}
      parentEntries={props.parentEntries ?? []}
      onNavigateInto={props.onNavigateInto ?? (() => {})}
      onParentRefresh={props.onParentRefresh ?? (() => {})}
      onPreviewImage={props.onPreviewImage ?? (() => {})}
      onSaveFile={props.onSaveFile ?? (() => {})}
      savingPath={props.savingPath ?? null}
      renderEntryRow={
        props.renderEntryRow ??
        ((entry) => (
          <button data-testid={`row-${entry.path}`}>{entry.name}</button>
        ))
      }
    />,
  );
}

describe("PipelineView — bucket strip", () => {
  it("renders an Inbox bucket plus all present states with their counts", async () => {
    const inboxFile = dropboxFile("loose.txt");
    setupDropboxListing({});
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        inboxFile,
      ],
    });
    const tablist = screen.getByRole("tablist", { name: /pipeline buckets/i });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual([
      "true",  // Inbox is selected by default
      "false",
      "false",
    ]);
    // Inbox count badge shows 1 (loose.txt). State counts default to "…"
    // until those buckets get loaded.
    expect(within(tabs[0]).getByText("1")).toBeInTheDocument();
  });

  it("hides the Inbox bucket when config sets inbox.show=false", () => {
    setupDropboxListing({});
    renderWith({
      config: configFixture({ inbox: { show: false } }),
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
      ],
    });
    expect(screen.queryByRole("tab", { name: /inbox/i })).not.toBeInTheDocument();
    // First state becomes the default selection.
    const processingTab = screen.getByRole("tab", { name: /processing/i });
    expect(processingTab).toHaveAttribute("aria-selected", "true");
  });

  it("uses a custom inbox name when configured", () => {
    setupDropboxListing({});
    renderWith({
      config: configFixture({
        inbox: { show: true, name: "Unfiled" },
      }),
      parentEntries: [],
    });
    expect(screen.getByRole("tab", { name: /unfiled/i })).toBeInTheDocument();
  });

  it("flags terminal states with an end marker", () => {
    setupDropboxListing({});
    renderWith({
      parentEntries: [dropboxFolder("3__published")],
    });
    const publishedTab = screen.getByRole("tab", { name: /published/i });
    expect(within(publishedTab).getByText(/end/i)).toBeInTheDocument();
  });

  it("warns when declared states have no matching folder", () => {
    setupDropboxListing({});
    renderWith({
      parentEntries: [dropboxFolder("1__Processing")],
    });
    expect(screen.getByRole("status")).toHaveTextContent(/2 declared states/i);
    expect(screen.getByRole("status")).toHaveTextContent(/Ready/);
    expect(screen.getByRole("status")).toHaveTextContent(/Published/);
  });
});

describe("PipelineView — bucket contents", () => {
  it("renders inbox items by default and excludes state folders + config file", () => {
    const inboxFile = dropboxFile("loose.txt");
    setupDropboxListing({});
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        {
          kind: "file",
          name: ".dropbox-interface.json",
          path: "/parent/.dropbox-interface.json",
          displayPath: "/parent/.dropbox-interface.json",
          size: 99,
          serverModified: null,
        },
        inboxFile,
      ],
    });
    expect(
      screen.getByTestId(`row-${inboxFile.path}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("row-/parent/1__Processing"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("row-/parent/.dropbox-interface.json"),
    ).not.toBeInTheDocument();
  });

  it("shows the inbox empty-state when there are no loose items", () => {
    setupDropboxListing({});
    renderWith({
      parentEntries: [dropboxFolder("1__Processing")],
    });
    expect(screen.getByText(/inbox is empty/i)).toBeInTheDocument();
  });

  it("lazy-loads a state's listing when its bucket is selected", async () => {
    const stateFile = dropboxFile("a.png", "/parent/1__Processing/a.png");
    const calls: string[] = [];
    setInvokeHandler("dropbox_list_folder", (args) => {
      calls.push((args as { path: string }).path);
      if ((args as { path: string }).path === "/parent/1__Processing") {
        return [stateFile];
      }
      return [];
    });
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");

    const user = userEvent.setup();
    renderWith({
      parentEntries: [dropboxFolder("1__Processing")],
    });
    expect(calls).toEqual([]);

    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await waitFor(() =>
      expect(
        screen.getByTestId(`row-${stateFile.path}`),
      ).toBeInTheDocument(),
    );
    expect(calls).toEqual(["/parent/1__Processing"]);
    // Count badge updates to reflect the loaded listing.
    const tab = screen.getByRole("tab", { name: /processing/i });
    expect(within(tab).getByText("1")).toBeInTheDocument();
  });

  it("does not refetch a state listing on subsequent reselects", async () => {
    const stateFile = dropboxFile("a.png", "/parent/1__Processing/a.png");
    const handler = vi.fn(() => [stateFile]);
    setInvokeHandler("dropbox_list_folder", handler);

    const user = userEvent.setup();
    renderWith({
      parentEntries: [dropboxFolder("1__Processing")],
    });

    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await screen.findByTestId(`row-${stateFile.path}`);
    const callsAfterFirst = handler.mock.calls.length;

    // Switch away, then back.
    await user.click(screen.getByRole("tab", { name: /inbox/i }));
    await user.click(screen.getByRole("tab", { name: /processing/i }));

    expect(handler.mock.calls.length).toBe(callsAfterFirst);
  });

  it("surfaces a state listing error and lets the user retry by reselect", async () => {
    let attempts = 0;
    setInvokeHandler("dropbox_list_folder", () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient network failure");
      }
      return [dropboxFile("a.png", "/parent/1__Processing/a.png")];
    });
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");

    const user = userEvent.setup();
    renderWith({
      parentEntries: [dropboxFolder("1__Processing")],
    });

    await user.click(screen.getByRole("tab", { name: /processing/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /transient network failure/,
    );

    // Reselecting the bucket retries.
    await user.click(screen.getByRole("tab", { name: /inbox/i }));
    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await waitFor(() =>
      expect(
        screen.getByTestId("row-/parent/1__Processing/a.png"),
      ).toBeInTheDocument(),
    );
  });
});

describe("PipelineView — Promote action", () => {
  function setupTwoStateFixture(opts: { promotable?: DropboxEntry } = {}) {
    const file =
      opts.promotable ??
      dropboxFile("a.png", "/parent/1__Processing/a.png");
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    const calls: { cmd: string; args: unknown }[] = [];
    setInvokeHandler("dropbox_list_folder", (args) => {
      calls.push({ cmd: "dropbox_list_folder", args });
      const path = (args as { path: string }).path;
      if (path === "/parent/1__Processing") {
        return [file];
      }
      return [];
    });
    return { calls, file };
  }

  it("renders a Promote button on state-bucket items pointing at the next state", async () => {
    setupTwoStateFixture();
    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
      ],
      renderEntryRow: (entry, opts) => (
        <div data-testid={`row-${entry.path}`}>
          <span>{entry.name}</span>
          {opts.promote ? (
            <button
              type="button"
              data-testid={`promote-${entry.path}`}
              onClick={opts.promote.onClick}
            >
              {opts.promote.inFlight ? "Moving…" : opts.promote.targetStateName}
            </button>
          ) : null}
        </div>
      ),
    });

    await user.click(screen.getByRole("tab", { name: /processing/i }));
    const btn = await screen.findByTestId(
      "promote-/parent/1__Processing/a.png",
    );
    expect(btn).toHaveTextContent("Ready");
  });

  it("renders Promote on Inbox items pointing at the first state", () => {
    setupTwoStateFixture();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        dropboxFile("loose.txt", "/parent/loose.txt"),
      ],
      renderEntryRow: (entry, opts) => (
        <div data-testid={`row-${entry.path}`}>
          <span>{entry.name}</span>
          {opts.promote ? (
            <span data-testid={`promote-target-${entry.path}`}>
              {opts.promote.targetStateName}
            </span>
          ) : null}
        </div>
      ),
    });
    // Inbox is selected by default; loose.txt is an inbox item.
    const target = screen.getByTestId("promote-target-/parent/loose.txt");
    expect(target).toHaveTextContent("Processing");
  });

  it("does not render Promote on Inbox items when the first state folder is missing", () => {
    // Only Ready exists; first state Processing is missing → no promote
    // target for the inbox.
    setupTwoStateFixture();
    renderWith({
      parentEntries: [
        dropboxFolder("2__ready"),
        dropboxFile("loose.txt", "/parent/loose.txt"),
      ],
      renderEntryRow: (entry, opts) => (
        <div data-testid={`row-${entry.path}`}>
          {entry.name}
          {opts.promote ? <span data-testid={`has-promote-${entry.path}`} /> : null}
        </div>
      ),
    });
    expect(
      screen.queryByTestId("has-promote-/parent/loose.txt"),
    ).not.toBeInTheDocument();
  });

  it("clicking Promote from Inbox moves the item to the first state and refreshes", async () => {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    const stateListings: Record<string, { count: number }> = {
      "/parent/1__Processing": { count: 0 },
    };
    setInvokeHandler("dropbox_list_folder", (args) => {
      const path = (args as { path: string }).path;
      const listing = stateListings[path];
      if (!listing) return [];
      // Each subsequent call returns one extra (post-move) entry.
      return Array.from({ length: listing.count }, (_, i) => ({
        kind: "file" as const,
        name: `n${i}.txt`,
        path: `${path}/n${i}.txt`,
        displayPath: `${path}/n${i}.txt`,
        size: 1,
        serverModified: null,
      }));
    });
    const moveSpy = vi.fn((args: unknown) => {
      const a = args as { fromPath: string; toPath: string };
      expect(a.fromPath).toBe("/parent/loose.txt");
      expect(a.toPath).toBe("/parent/1__Processing/loose.txt");
      stateListings["/parent/1__Processing"].count = 1;
      return {
        kind: "file",
        name: "loose.txt",
        path: a.toPath,
        displayPath: a.toPath,
        size: 1,
        serverModified: null,
      };
    });
    setInvokeHandler("dropbox_move_v2", moveSpy);
    const onParentRefresh = vi.fn();

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        dropboxFile("loose.txt", "/parent/loose.txt"),
      ],
      onParentRefresh,
      renderEntryRow: (entry, opts) => (
        <button
          type="button"
          data-testid={`promote-${entry.path}`}
          disabled={!opts.promote}
          onClick={() => opts.promote?.onClick()}
        >
          {opts.promote?.targetStateName ?? entry.name}
        </button>
      ),
    });

    await user.click(screen.getByTestId("promote-/parent/loose.txt"));
    await waitFor(() => expect(moveSpy).toHaveBeenCalledTimes(1));
    // Inbox source → parent listing must refresh (where the loose item
    // disappeared from). Destination state listing also refreshes.
    expect(onParentRefresh).toHaveBeenCalled();
    expect(
      await screen.findByLabelText(/move completed/i),
    ).toHaveTextContent(/Processing/);
  });

  it("does not render Promote on the terminal state", async () => {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_list_folder", (args) => {
      const path = (args as { path: string }).path;
      if (path === "/parent/3__published") {
        return [dropboxFile("done.png", "/parent/3__published/done.png")];
      }
      return [];
    });
    const user = userEvent.setup();
    renderWith({
      parentEntries: [dropboxFolder("3__published")],
      renderEntryRow: (entry, opts) => (
        <div data-testid={`row-${entry.path}`}>
          {entry.name}
          {opts.promote ? <span data-testid={`has-promote-${entry.path}`} /> : null}
        </div>
      ),
    });
    await user.click(screen.getByRole("tab", { name: /published/i }));
    await screen.findByTestId("row-/parent/3__published/done.png");
    expect(
      screen.queryByTestId("has-promote-/parent/3__published/done.png"),
    ).not.toBeInTheDocument();
  });

  it("does not render Promote when the destination state folder is missing", async () => {
    setupTwoStateFixture();
    const user = userEvent.setup();
    // Only Processing exists; Ready / Published are missing.
    renderWith({
      parentEntries: [dropboxFolder("1__Processing")],
      renderEntryRow: (entry, opts) => (
        <div data-testid={`row-${entry.path}`}>
          {entry.name}
          {opts.promote ? (
            <span data-testid={`has-promote-${entry.path}`} />
          ) : null}
        </div>
      ),
    });
    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await screen.findByTestId("row-/parent/1__Processing/a.png");
    expect(
      screen.queryByTestId("has-promote-/parent/1__Processing/a.png"),
    ).not.toBeInTheDocument();
  });

  it("clicking Promote calls dropbox_move_v2 with the correct paths", async () => {
    setupTwoStateFixture();
    const moveSpy = vi.fn((args: unknown) => {
      expect(args).toMatchObject({
        fromPath: "/parent/1__Processing/a.png",
        toPath: "/parent/2__ready/a.png",
      });
      return {
        kind: "file",
        name: "a.png",
        path: "/parent/2__ready/a.png",
        displayPath: "/parent/2__ready/a.png",
        size: 1,
        serverModified: null,
      };
    });
    setInvokeHandler("dropbox_move_v2", moveSpy);

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
      ],
      renderEntryRow: (entry, opts) => (
        <button
          type="button"
          data-testid={`promote-${entry.path}`}
          disabled={!opts.promote}
          onClick={() => opts.promote?.onClick()}
        >
          Promote
        </button>
      ),
    });

    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await user.click(
      await screen.findByTestId("promote-/parent/1__Processing/a.png"),
    );
    await waitFor(() => expect(moveSpy).toHaveBeenCalledTimes(1));

    // Undo toast appears
    expect(
      await screen.findByLabelText(/move completed/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Moved/i)).toHaveTextContent(/a\.png/);
  });

  it("Undo reverses the move with another dropbox_move_v2 call", async () => {
    setupTwoStateFixture();
    const moveCalls: { fromPath: string; toPath: string }[] = [];
    setInvokeHandler("dropbox_move_v2", (args) => {
      moveCalls.push(args as { fromPath: string; toPath: string });
      return {
        kind: "file",
        name: "a.png",
        path: (args as { toPath: string }).toPath,
        displayPath: (args as { toPath: string }).toPath,
        size: 1,
        serverModified: null,
      };
    });

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
      ],
      renderEntryRow: (entry, opts) => (
        <button
          type="button"
          data-testid={`promote-${entry.path}`}
          disabled={!opts.promote}
          onClick={() => opts.promote?.onClick()}
        >
          Promote
        </button>
      ),
    });

    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await user.click(
      await screen.findByTestId("promote-/parent/1__Processing/a.png"),
    );
    await screen.findByLabelText(/move completed/i);

    await user.click(screen.getByRole("button", { name: /undo move/i }));
    await waitFor(() => expect(moveCalls).toHaveLength(2));
    expect(moveCalls[0]).toMatchObject({
      fromPath: "/parent/1__Processing/a.png",
      toPath: "/parent/2__ready/a.png",
    });
    expect(moveCalls[1]).toMatchObject({
      fromPath: "/parent/2__ready/a.png",
      toPath: "/parent/1__Processing/a.png",
    });
  });

  it("surfaces a move error and leaves the cache intact", async () => {
    setupTwoStateFixture();
    setInvokeHandler("dropbox_move_v2", () => {
      throw new Error("dropbox returned an error: 409 to/conflict");
    });

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
      ],
      renderEntryRow: (entry, opts) => (
        <button
          type="button"
          data-testid={`promote-${entry.path}`}
          disabled={!opts.promote}
          onClick={() => opts.promote?.onClick()}
        >
          Promote
        </button>
      ),
    });

    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await user.click(
      await screen.findByTestId("promote-/parent/1__Processing/a.png"),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/to\/conflict/);
    // No undo toast
    expect(screen.queryByLabelText(/move completed/i)).not.toBeInTheDocument();
  });

  it("dismiss button clears the undo toast", async () => {
    setupTwoStateFixture();
    setInvokeHandler("dropbox_move_v2", () => ({
      kind: "file",
      name: "a.png",
      path: "/parent/2__ready/a.png",
      displayPath: "/parent/2__ready/a.png",
      size: 1,
      serverModified: null,
    }));

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
      ],
      renderEntryRow: (entry, opts) => (
        <button
          type="button"
          data-testid={`promote-${entry.path}`}
          disabled={!opts.promote}
          onClick={() => opts.promote?.onClick()}
        >
          Promote
        </button>
      ),
    });
    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await user.click(
      await screen.findByTestId("promote-/parent/1__Processing/a.png"),
    );
    await screen.findByLabelText(/move completed/i);

    await user.click(
      screen.getByRole("button", { name: /dismiss undo notification/i }),
    );
    expect(
      screen.queryByLabelText(/move completed/i),
    ).not.toBeInTheDocument();
  });
});

describe("PipelineView — drag-and-drop between buckets", () => {
  /**
   * jsdom's DataTransfer is shallow; helper builds a stub that supports
   * the methods the component calls.
   */
  function fakeDataTransfer() {
    const data = new Map<string, string>();
    return {
      data,
      effectAllowed: "none",
      dropEffect: "none",
      setData(format: string, value: string) {
        data.set(format, value);
      },
      getData(format: string) {
        return data.get(format) ?? "";
      },
    };
  }

  function dragEntryToBucket(entryPath: string, bucketName: RegExp) {
    const dt = fakeDataTransfer();
    const row = screen.getByTestId(`row-${entryPath}`).closest("li");
    if (!row) throw new Error(`row for ${entryPath} not in document`);
    fireEvent.dragStart(row, { dataTransfer: dt });
    const target = screen.getByRole("tab", { name: bucketName });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    fireEvent.dragEnd(row, { dataTransfer: dt });
  }

  function setupTwoStateForDrag() {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_list_folder", () => []);
  }

  const renderRowWithTestid: React.ComponentProps<
    typeof PipelineView
  >["renderEntryRow"] = (entry, _opts) => (
    <div data-testid={`row-${entry.path}`}>{entry.name}</div>
  );

  it("drag from Inbox row to a state chip fires move and refreshes parent", async () => {
    setupTwoStateForDrag();
    const moveSpy = vi.fn(() => ({
      kind: "file",
      name: "x.txt",
      path: "/parent/2__ready/x.txt",
      displayPath: "/parent/2__ready/x.txt",
      size: 1,
      serverModified: null,
    }));
    setInvokeHandler("dropbox_move_v2", moveSpy);
    const onParentRefresh = vi.fn();

    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        dropboxFile("x.txt", "/parent/x.txt"),
      ],
      onParentRefresh,
      renderEntryRow: renderRowWithTestid,
    });

    dragEntryToBucket("/parent/x.txt", /^Ready/i);

    await waitFor(() => expect(moveSpy).toHaveBeenCalledTimes(1));
    expect(moveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPath: "/parent/x.txt",
        toPath: "/parent/2__ready/x.txt",
      }),
    );
    expect(onParentRefresh).toHaveBeenCalled();
  });

  it("drag from a state row onto Inbox un-files the item to the parent root", async () => {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_list_folder", (args) => {
      if ((args as { path: string }).path === "/parent/1__Processing") {
        return [dropboxFile("x.txt", "/parent/1__Processing/x.txt")];
      }
      return [];
    });
    const moveSpy = vi.fn(() => ({
      kind: "file",
      name: "x.txt",
      path: "/parent/x.txt",
      displayPath: "/parent/x.txt",
      size: 1,
      serverModified: null,
    }));
    setInvokeHandler("dropbox_move_v2", moveSpy);
    const onParentRefresh = vi.fn();

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
      ],
      onParentRefresh,
      renderEntryRow: renderRowWithTestid,
    });

    // Switch to Processing so the row is rendered.
    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await screen.findByTestId("row-/parent/1__Processing/x.txt");

    dragEntryToBucket("/parent/1__Processing/x.txt", /^Inbox/i);

    await waitFor(() => expect(moveSpy).toHaveBeenCalledTimes(1));
    expect(moveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPath: "/parent/1__Processing/x.txt",
        toPath: "/parent/x.txt",
      }),
    );
    expect(onParentRefresh).toHaveBeenCalled();
  });

  it("drag onto the same bucket is a no-op (no move call)", async () => {
    setupTwoStateForDrag();
    const moveSpy = vi.fn();
    setInvokeHandler("dropbox_move_v2", moveSpy);

    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        dropboxFile("x.txt", "/parent/x.txt"),
      ],
      renderEntryRow: renderRowWithTestid,
    });

    // Drop the inbox item onto the inbox tab itself.
    dragEntryToBucket("/parent/x.txt", /^Inbox/i);

    // Nothing fired.
    await new Promise((r) => setTimeout(r, 30));
    expect(moveSpy).not.toHaveBeenCalled();
  });

  it("drag onto a bucket whose state folder is missing still drops if target is Inbox", async () => {
    // Specifically: dropping on Inbox is always valid. Dropping on a
    // missing state shouldn't even be possible because the chip isn't
    // rendered. We assert that here.
    setupTwoStateForDrag();
    renderWith({
      parentEntries: [dropboxFolder("1__Processing")], // Ready missing
      renderEntryRow: renderRowWithTestid,
    });
    expect(
      screen.queryByRole("tab", { name: /^Ready/i }),
    ).not.toBeInTheDocument();
  });

  it("malformed dataTransfer payload is ignored without crashing", async () => {
    setupTwoStateForDrag();
    const moveSpy = vi.fn();
    setInvokeHandler("dropbox_move_v2", moveSpy);

    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        dropboxFile("x.txt", "/parent/x.txt"),
      ],
      renderEntryRow: renderRowWithTestid,
    });

    const target = screen.getByRole("tab", { name: /^Ready/i });
    const dt = fakeDataTransfer();
    dt.setData("application/x-dropbox-pipeline-entry", "{not-json");
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    await new Promise((r) => setTimeout(r, 30));
    expect(moveSpy).not.toHaveBeenCalled();
  });
});

describe("PipelineView — Pin button", () => {
  it("toggles pinned status for the current pipeline", async () => {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_list_folder", () => []);

    // Seed the recents list so setPinned has something to mutate.
    localStorage.setItem(
      "dropbox-interface:recent-pipelines",
      JSON.stringify([
        { path: "/parent", name: "Test pipeline", visitedAt: 1 },
      ]),
    );

    const user = userEvent.setup();
    renderWith({ parentEntries: [dropboxFolder("1__Processing")] });

    const pinBtn = screen.getByRole("button", { name: /pin pipeline/i });
    expect(pinBtn).toHaveAttribute("aria-pressed", "false");

    await user.click(pinBtn);
    expect(
      screen.getByRole("button", { name: /unpin pipeline/i }),
    ).toHaveAttribute("aria-pressed", "true");

    const stored = JSON.parse(
      localStorage.getItem("dropbox-interface:recent-pipelines")!,
    );
    expect(stored[0]).toMatchObject({ path: "/parent", pinned: true });
  });
});

describe("PipelineView — Bulk Promote", () => {
  function setupBulkFixture() {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    const items = [
      dropboxFile("a.png", "/parent/a.png"),
      dropboxFile("b.png", "/parent/b.png"),
      dropboxFile("c.png", "/parent/c.png"),
    ];
    setInvokeHandler("dropbox_list_folder", () => []);
    return items;
  }

  function checkbox(entry: DropboxEntry) {
    return screen.getByRole("checkbox", {
      name: new RegExp(`select ${entry.name.replace(/\./g, "\\.")}`, "i"),
    });
  }

  it("checkboxes toggle selection state and bulk toolbar reflects count", async () => {
    const items = setupBulkFixture();
    const user = userEvent.setup();

    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        ...items,
      ],
      renderEntryRow: (entry, opts) => (
        <div data-testid={`row-${entry.path}`}>
          {opts.select ? (
            <input
              type="checkbox"
              aria-label={`Select ${entry.name}`}
              checked={opts.select.selected}
              onChange={opts.select.onToggle}
            />
          ) : null}
          <span>{entry.name}</span>
        </div>
      ),
    });

    // Inbox is selected by default; pick two items.
    await user.click(checkbox(items[0]));
    await user.click(checkbox(items[1]));

    const toolbar = screen.getByRole("toolbar", { name: /bulk actions/i });
    expect(toolbar).toHaveTextContent(/2/);
    // Promote target is the first state.
    expect(
      within(toolbar).getByRole("button", { name: /promote 2 to processing/i }),
    ).toBeInTheDocument();
  });

  it("Clear button drops the selection", async () => {
    const items = setupBulkFixture();
    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        ...items,
      ],
      renderEntryRow: (entry, opts) => (
        <div data-testid={`row-${entry.path}`}>
          {opts.select ? (
            <input
              type="checkbox"
              aria-label={`Select ${entry.name}`}
              checked={opts.select.selected}
              onChange={opts.select.onToggle}
            />
          ) : null}
          <span>{entry.name}</span>
        </div>
      ),
    });

    await user.click(checkbox(items[0]));
    await user.click(checkbox(items[1]));
    await user.click(screen.getByRole("button", { name: /clear selection/i }));
    expect(
      screen.queryByRole("toolbar", { name: /bulk actions/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking bulk Promote moves all selected items in parallel and shows a single toast", async () => {
    const items = setupBulkFixture();
    const moves: { fromPath: string; toPath: string }[] = [];
    setInvokeHandler("dropbox_move_v2", (args) => {
      const a = args as { fromPath: string; toPath: string };
      moves.push(a);
      return {
        kind: "file",
        name: a.toPath.split("/").pop(),
        path: a.toPath,
        displayPath: a.toPath,
        size: 1,
        serverModified: null,
      };
    });

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        ...items,
      ],
      renderEntryRow: (entry, opts) => (
        <div data-testid={`row-${entry.path}`}>
          {opts.select ? (
            <input
              type="checkbox"
              aria-label={`Select ${entry.name}`}
              checked={opts.select.selected}
              onChange={opts.select.onToggle}
            />
          ) : null}
          <span>{entry.name}</span>
        </div>
      ),
    });

    await user.click(checkbox(items[0]));
    await user.click(checkbox(items[1]));

    await user.click(
      screen.getByRole("button", { name: /promote 2 to processing/i }),
    );

    await waitFor(() => expect(moves).toHaveLength(2));
    const toPaths = moves.map((m) => m.toPath).sort();
    expect(toPaths).toEqual([
      "/parent/1__Processing/a.png",
      "/parent/1__Processing/b.png",
    ]);

    // Single batch undo toast for the 2 successful moves.
    const toast = await screen.findByLabelText(/move completed/i);
    expect(toast).toHaveTextContent(/2 items/);
    expect(toast).toHaveTextContent(/Processing/);
  });

  it("partial failure surfaces an error count and still pops a toast for the successful moves", async () => {
    const items = setupBulkFixture();
    let callIdx = 0;
    setInvokeHandler("dropbox_move_v2", (args) => {
      callIdx += 1;
      if (callIdx === 2) {
        throw new Error("dropbox returned an error: 409 to/conflict");
      }
      const a = args as { toPath: string };
      return {
        kind: "file",
        name: a.toPath.split("/").pop(),
        path: a.toPath,
        displayPath: a.toPath,
        size: 1,
        serverModified: null,
      };
    });

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
        ...items,
      ],
      renderEntryRow: (entry, opts) => (
        <div data-testid={`row-${entry.path}`}>
          {opts.select ? (
            <input
              type="checkbox"
              aria-label={`Select ${entry.name}`}
              checked={opts.select.selected}
              onChange={opts.select.onToggle}
            />
          ) : null}
          <span>{entry.name}</span>
        </div>
      ),
    });

    await user.click(checkbox(items[0]));
    await user.click(checkbox(items[1]));
    await user.click(
      screen.getByRole("button", { name: /promote 2 to processing/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /1 of 2 moves failed/i,
    );
    // Successful one still goes into the undo toast (single-move text).
    expect(
      await screen.findByLabelText(/move completed/i),
    ).toBeInTheDocument();
  });
});

describe("PipelineView — Notes editor", () => {
  beforeEach(() => {
    localStorage.removeItem("dropbox-interface:pipeline-notes");
  });

  function rowWithNoteSlot(entry: DropboxEntry, opts: {
    note?: { hasNote: boolean; onClick: () => void };
  }) {
    return (
      <div data-testid={`row-${entry.path}`}>
        <span>{entry.name}</span>
        {opts.note ? (
          <>
            <button
              type="button"
              data-testid={`open-note-${entry.path}`}
              onClick={opts.note.onClick}
            >
              note
            </button>
            {opts.note.hasNote ? (
              <span data-testid={`has-note-${entry.path}`} />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  it("opens the editor modal when a row's note button fires onClick", async () => {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_list_folder", () => []);

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFile("loose.txt", "/parent/loose.txt"),
      ],
      renderEntryRow: (entry, opts) => rowWithNoteSlot(entry, opts),
    });

    await user.click(screen.getByTestId("open-note-/parent/loose.txt"));
    const dialog = await screen.findByRole("dialog", { name: /note: loose\.txt/i });
    expect(dialog).toBeInTheDocument();
  });

  it("Save persists the note to localStorage and the row gets a has-note indicator on next open", async () => {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_list_folder", () => []);

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFile("loose.txt", "/parent/loose.txt"),
      ],
      renderEntryRow: (entry, opts) => rowWithNoteSlot(entry, opts),
    });

    await user.click(screen.getByTestId("open-note-/parent/loose.txt"));
    await user.type(
      screen.getByRole("textbox", { name: /note body/i }),
      "Looks great",
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Modal closes, indicator dot shows.
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /note: loose\.txt/i }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("has-note-/parent/loose.txt"),
    ).toBeInTheDocument();
    // Underlying storage reflects the save.
    const stored = JSON.parse(
      localStorage.getItem("dropbox-interface:pipeline-notes")!,
    );
    expect(stored["/parent/loose.txt"]).toMatchObject({
      body: "Looks great",
    });
  });

  it("Cancel discards the textarea contents", async () => {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_list_folder", () => []);

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFile("loose.txt", "/parent/loose.txt"),
      ],
      renderEntryRow: (entry, opts) => rowWithNoteSlot(entry, opts),
    });

    await user.click(screen.getByTestId("open-note-/parent/loose.txt"));
    await user.type(
      screen.getByRole("textbox", { name: /note body/i }),
      "tentative",
    );
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /note/i }),
      ).not.toBeInTheDocument(),
    );
    expect(
      localStorage.getItem("dropbox-interface:pipeline-notes"),
    ).toBeNull();
  });

  it("Esc closes the editor without saving", async () => {
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    setInvokeHandler("dropbox_list_folder", () => []);

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFile("loose.txt", "/parent/loose.txt"),
      ],
      renderEntryRow: (entry, opts) => rowWithNoteSlot(entry, opts),
    });

    await user.click(screen.getByTestId("open-note-/parent/loose.txt"));
    await user.type(
      screen.getByRole("textbox", { name: /note body/i }),
      "drafty",
    );
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /note/i }),
      ).not.toBeInTheDocument(),
    );
    expect(
      localStorage.getItem("dropbox-interface:pipeline-notes"),
    ).toBeNull();
  });
});

describe("PipelineView — Create missing state folder", () => {
  it("renders a Create folder button per missing state and calls dropbox_create_folder_v2", async () => {
    setInvokeHandler("dropbox_list_folder", () => []);
    const createSpy = vi.fn((args) => {
      expect(args).toMatchObject({ path: "/parent/2__ready" });
      return {
        kind: "folder",
        name: "2__ready",
        path: "/parent/2__ready",
        displayPath: "/parent/2__ready",
        size: null,
        serverModified: null,
      };
    });
    setInvokeHandler("dropbox_create_folder_v2", createSpy);
    const onParentRefresh = vi.fn();

    const user = userEvent.setup();
    renderWith({
      parentEntries: [dropboxFolder("1__Processing")],
      onParentRefresh,
    });

    expect(screen.getByRole("status")).toHaveTextContent(/2 declared states/);
    await user.click(
      screen.getByRole("button", { name: /create folder 2__ready/i }),
    );
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(onParentRefresh).toHaveBeenCalledTimes(1);
  });

  it("surfaces create-folder errors", async () => {
    setInvokeHandler("dropbox_list_folder", () => []);
    setInvokeHandler("dropbox_create_folder_v2", () => {
      throw new Error("dropbox returned an error: 409 path/conflict");
    });

    const user = userEvent.setup();
    renderWith({
      parentEntries: [dropboxFolder("1__Processing")],
    });
    await user.click(
      screen.getByRole("button", { name: /create folder 2__ready/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /path\/conflict/,
    );
  });
});

describe("PipelineView — lazy-load cancellation", () => {
  it("recovers from a rapid bucket switch without wedging the original bucket at 'Loading…'", async () => {
    // Reproduces the bug where the lazy-load effect's cleanup left the
    // bucket id in fetchedRef even after cancellation, causing return
    // visits to skip the re-fetch and stay at "Loading…" forever.
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");
    let resolveFirst: (() => void) | null = null;
    const firstFetchStarted = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const handler = vi.fn((args: unknown) => {
      const path = (args as { path: string }).path;
      if (path === "/parent/1__Processing") {
        // Signal that the first fetch started, then resolve once the
        // test has switched away.
        resolveFirst?.();
      }
      return [
        {
          kind: "file" as const,
          name: "x.png",
          path: `${path}/x.png`,
          displayPath: `${path}/x.png`,
          size: 1,
          serverModified: null,
        },
      ];
    });
    setInvokeHandler("dropbox_list_folder", handler);

    const user = userEvent.setup();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
        dropboxFolder("2__ready"),
      ],
    });

    // Select Processing — first fetch begins.
    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await firstFetchStarted;

    // Immediately switch away — effect cleanup should clear the
    // in-flight marker so a later re-select can fetch again.
    await user.click(screen.getByRole("tab", { name: /ready/i }));

    // Come back to Processing.
    await user.click(screen.getByRole("tab", { name: /processing/i }));

    // The bucket should resolve to ready, not stay "Loading…".
    expect(
      await screen.findByTestId("row-/parent/1__Processing/x.png"),
    ).toBeInTheDocument();
  });
});

describe("PipelineView — selection persistence across parent changes", () => {
  it("resets the cached state listings when parentPath changes", async () => {
    const handler = vi.fn((args: unknown) => {
      const path = (args as { path: string }).path;
      return [dropboxFile("x.png", `${path}/x.png`)];
    });
    setInvokeHandler("dropbox_list_folder", handler);
    setInvokeHandler("dropbox_get_thumbnail", () => "data:image/jpeg;base64,zz");

    const user = userEvent.setup();
    const { rerender } = renderWith({
      parentPath: "/parent",
      parentEntries: [dropboxFolder("1__Processing", "/parent/1__Processing")],
    });

    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await screen.findByTestId("row-/parent/1__Processing/x.png");

    // Navigate to a different parent — same folder name, different path.
    const config = configFixture();
    rerender(
      <PipelineView
        parentPath="/other"
        config={config}
        parentEntries={[dropboxFolder("1__Processing", "/other/1__Processing")]}
        onNavigateInto={() => {}}
        onParentRefresh={() => {}}
        onPreviewImage={() => {}}
        onSaveFile={() => {}}
        savingPath={null}
        renderEntryRow={(entry) => (
          <button data-testid={`row-${entry.path}`}>{entry.name}</button>
        )}
      />,
    );
    // Selecting Processing now should fetch the *new* path's listing.
    await user.click(screen.getByRole("tab", { name: /processing/i }));
    await waitFor(() =>
      expect(
        screen.getByTestId("row-/other/1__Processing/x.png"),
      ).toBeInTheDocument(),
    );
    expect(
      handler.mock.calls.map((c) => (c[0] as { path: string }).path),
    ).toContain("/other/1__Processing");
  });
});
