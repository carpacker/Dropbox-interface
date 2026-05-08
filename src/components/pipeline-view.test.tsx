import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

  it("does not render Promote on Inbox items", async () => {
    setupTwoStateFixture();
    renderWith({
      parentEntries: [
        dropboxFolder("1__Processing"),
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
