import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearJobTrackerConfig,
  saveJobTrackerConfig,
} from "@/lib/job-tracker-config";
import { setInvokeHandler } from "@/test/tauri-core-mock";
import { setNextOpenResult } from "@/test/tauri-dialog-mock";

import { JobTrackerApp } from "./job-tracker-app";

const csv = [
  "id,client,status,due",
  "alpha,Acme,Inquiry,2026-05-10",
  "bravo,Beta Co,Booked,2026-05-12",
  "charlie,Cargo Inc,Editing,2026-05-15",
  "delta,Delta Studio,Booked,2026-05-20",
].join("\n");

function setupJobsFs(opts: {
  rootPath?: string;
  csvBody?: string;
  filesByRowKey?: Record<string, Array<{ name: string; path?: string }>>;
  threadsByRowKey?: Record<string, string>;
}) {
  setInvokeHandler("local_read_text_file", (args) => {
    const path = (args as { path: string }).path;
    if (path.endsWith("jobs.csv")) return opts.csvBody ?? null;
    // Thread reads land at <root>/threads/<rowKey>.jsonl
    const threadMatch = path.match(/[/\\]threads[/\\]([^/\\]+)\.jsonl$/);
    if (threadMatch) {
      return opts.threadsByRowKey?.[threadMatch[1]] ?? null;
    }
    return null;
  });
  setInvokeHandler("list_directory", (args) => {
    const path = (args as { path: string }).path;
    const m = path.match(/[/\\]files[/\\]([^/\\]+)$/);
    if (!m) throw new Error("Not a directory: " + path);
    const rows = opts.filesByRowKey?.[m[1]];
    if (!rows) throw new Error("Not a directory: " + path);
    return rows.map((r) => ({
      name: r.name,
      path: r.path ?? `${path}/${r.name}`,
      isDirectory: false,
      size: 100,
      modified: null,
    }));
  });
}

beforeEach(() => clearJobTrackerConfig());
afterEach(() => clearJobTrackerConfig());

describe("JobTrackerApp — setup card", () => {
  it("renders a 'Pick Job Tracker folder' card when unconfigured", () => {
    render(<JobTrackerApp />);
    expect(
      screen.getByRole("button", { name: /pick job tracker folder/i }),
    ).toBeInTheDocument();
  });

  it("auto-loads when a saved root + valid CSV are present", async () => {
    saveJobTrackerConfig({ rootPath: "/r" });
    setupJobsFs({ csvBody: csv });
    render(<JobTrackerApp />);
    // Wait for the board to render its three status columns.
    const board = await screen.findByRole("list", { name: /job board/i });
    expect(
      within(board).getByLabelText(/status: inquiry/i),
    ).toBeInTheDocument();
    expect(
      within(board).getByLabelText(/status: booked/i),
    ).toBeInTheDocument();
    expect(
      within(board).getByLabelText(/status: editing/i),
    ).toBeInTheDocument();
  });
});

describe("JobTrackerApp — board layout", () => {
  beforeEach(() => {
    saveJobTrackerConfig({ rootPath: "/r" });
  });

  it("renders one column per derived status value, with row counts", async () => {
    setupJobsFs({ csvBody: csv });
    render(<JobTrackerApp />);
    const board = await screen.findByRole("list", { name: /job board/i });
    // Use the aria-label prefix so we count columns only (not the
    // cards nested inside each column as <li role="listitem">).
    const columns = within(board).getAllByRole("listitem", {
      name: /^status:/i,
    });
    expect(columns).toHaveLength(3);
    const inquiry = within(board).getByLabelText(/status: inquiry/i);
    const booked = within(board).getByLabelText(/status: booked/i);
    expect(within(inquiry).getByText("1")).toBeInTheDocument(); // alpha
    expect(within(booked).getByText("2")).toBeInTheDocument(); // bravo, delta
  });

  it("ungrouped rows (no status column) all land in 'Backlog'", async () => {
    setupJobsFs({
      csvBody: "id,client\nalpha,Acme\nbravo,Beta Co",
    });
    render(<JobTrackerApp />);
    const board = await screen.findByRole("list", { name: /job board/i });
    const cols = within(board).getAllByRole("listitem", {
      name: /^status:/i,
    });
    expect(cols).toHaveLength(1);
    expect(cols[0].getAttribute("aria-label")).toBe("Status: Backlog");
    expect(within(cols[0]).getByText("2")).toBeInTheDocument();
    // Toolbar should announce the missing-column condition. The text
    // is broken across <span>/<code>/text nodes so use a normalizer.
    // Function matcher walks the tree; multiple ancestors will
    // match — getAllByText + length is enough to assert the
    // condition was announced.
    expect(
      screen.getAllByText((_content, node) =>
        Boolean(
          node?.textContent &&
            /no .*status.* column/i.test(node.textContent),
        ),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("rows with empty status fall into the synthetic 'Backlog' bucket appended at the end", async () => {
    setupJobsFs({
      csvBody: [
        "id,client,status",
        "alpha,Acme,Inquiry",
        "bravo,Beta Co,",  // empty status
      ].join("\n"),
    });
    render(<JobTrackerApp />);
    const board = await screen.findByRole("list", { name: /job board/i });
    const cols = within(board).getAllByRole("listitem", {
      name: /^status:/i,
    });
    expect(cols.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Status: Inquiry",
      "Status: Backlog",
    ]);
    expect(within(cols[1]).getByText(/Beta Co/)).toBeInTheDocument();
  });

  it("filtering shrinks card counts per column without removing columns", async () => {
    setupJobsFs({ csvBody: csv });
    const user = userEvent.setup();
    render(<JobTrackerApp />);
    await screen.findByLabelText(/status: booked/i);

    await user.type(screen.getByLabelText(/filter jobs/i), "delta");
    const board = await screen.findByRole("list", { name: /job board/i });
    expect(
      within(board).getAllByRole("listitem", { name: /^status:/i }),
    ).toHaveLength(3);
    const booked = within(board).getByLabelText(/status: booked/i);
    expect(within(booked).getByText("1")).toBeInTheDocument();
    const inquiry = within(board).getByLabelText(/status: inquiry/i);
    expect(within(inquiry).getByText(/no jobs/i)).toBeInTheDocument();
  });
});

describe("JobTrackerApp — detail panel", () => {
  beforeEach(() => {
    saveJobTrackerConfig({ rootPath: "/r" });
  });

  it("clicking a card opens the detail panel with all fields", async () => {
    setupJobsFs({ csvBody: csv });
    const user = userEvent.setup();
    render(<JobTrackerApp />);
    await screen.findByLabelText(/status: inquiry/i);
    await user.click(screen.getByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });
    expect(within(panel).getByText("Acme")).toBeInTheDocument();
    expect(within(panel).getByText("Inquiry")).toBeInTheDocument();
    expect(within(panel).getByText("2026-05-10")).toBeInTheDocument();
  });

  it("reports 'no files attached' when the sidecar folder is missing", async () => {
    setupJobsFs({ csvBody: csv });
    const user = userEvent.setup();
    render(<JobTrackerApp />);
    await user.click(await screen.findByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });
    expect(
      await within(panel).findByText(/no files attached/i),
    ).toBeInTheDocument();
  });

  it("lists attachments from <root>/files/<rowKey>/", async () => {
    setupJobsFs({
      csvBody: csv,
      filesByRowKey: {
        alpha: [{ name: "brief.pdf", path: "/r/files/alpha/brief.pdf" }],
      },
    });
    const user = userEvent.setup();
    render(<JobTrackerApp />);
    await user.click(await screen.findByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });
    expect(await within(panel).findByText("brief.pdf")).toBeInTheDocument();
  });

  it("reports 'no thread yet' when the JSONL file is missing", async () => {
    setupJobsFs({ csvBody: csv });
    const user = userEvent.setup();
    render(<JobTrackerApp />);
    await user.click(await screen.findByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });
    expect(
      await within(panel).findByText(/no thread yet/i),
    ).toBeInTheDocument();
  });

  it("renders parsed thread entries with byline + body", async () => {
    setupJobsFs({
      csvBody: csv,
      threadsByRowKey: {
        alpha: [
          JSON.stringify({
            at: "2026-05-01T10:00:00Z",
            by: "Carson",
            kind: "note",
            body: "Inquiry email received.",
          }),
          JSON.stringify({
            at: "2026-05-02T14:30:00Z",
            by: "Paige",
            kind: "note",
            body: "Sent quote.",
          }),
        ].join("\n"),
      },
    });
    const user = userEvent.setup();
    render(<JobTrackerApp />);
    await user.click(await screen.findByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });
    expect(await within(panel).findByText("Inquiry email received.")).toBeInTheDocument();
    expect(within(panel).getByText("Sent quote.")).toBeInTheDocument();
    expect(within(panel).getByText(/Carson/)).toBeInTheDocument();
  });

  it("surfaces 'N lines skipped' when the thread has malformed lines", async () => {
    setupJobsFs({
      csvBody: csv,
      threadsByRowKey: {
        alpha: [
          '{"at":"a","by":"x","kind":"note","body":"good"}',
          "{not json",
          '{"at":"c","by":"x","kind":"note","body":"also good"}',
        ].join("\n"),
      },
    });
    const user = userEvent.setup();
    render(<JobTrackerApp />);
    await user.click(await screen.findByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });
    expect(
      await within(panel).findByText(/1 malformed line skipped/i),
    ).toBeInTheDocument();
  });
});

describe("JobTrackerApp — edit + status change", () => {
  beforeEach(() => {
    saveJobTrackerConfig({ rootPath: "/r" });
  });

  function captureWrites() {
    const captured: Array<{ path: string; contents: string }> = [];
    setInvokeHandler("local_write_text_file", (args) => {
      const a = args as { path: string; contents: string };
      captured.push(a);
      return {
        name: "jobs.csv",
        path: a.path,
        isDirectory: false,
        size: a.contents.length,
        modified: null,
      };
    });
    return captured;
  }

  it("Edit button opens a modal pre-populated with the row's fields", async () => {
    setupJobsFs({ csvBody: csv });
    captureWrites();

    const user = userEvent.setup();
    render(<JobTrackerApp />);
    await user.click(await screen.findByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });
    await user.click(within(panel).getByRole("button", { name: /edit job/i }));

    const dialog = await screen.findByRole("dialog", { name: /edit job/i });
    expect(
      (within(dialog).getByLabelText("client") as HTMLInputElement).value,
    ).toBe("Acme");
  });

  it("changing the status column persists the rewritten CSV and moves the card", async () => {
    setupJobsFs({ csvBody: csv });
    const writes = captureWrites();
    const user = userEvent.setup();
    render(<JobTrackerApp />);

    await user.click(await screen.findByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });
    await user.click(within(panel).getByRole("button", { name: /edit job/i }));

    const dialog = await screen.findByRole("dialog", { name: /edit job/i });
    const select = within(dialog).getByLabelText("status") as HTMLSelectElement;
    await user.selectOptions(select, "Editing");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0].path).toBe("/r/jobs.csv");
    // The new CSV body has alpha under Editing.
    expect(writes[0].contents).toMatch(/alpha,Acme,Editing/);

    // Card now lives in the Editing column. The card's primary
    // text is the id (`alpha`), so query by that.
    const board = await screen.findByRole("list", { name: /job board/i });
    const editing = within(board).getByLabelText(/status: editing/i);
    expect(within(editing).getByText("alpha")).toBeInTheDocument();
  });

  it("refuses to save when the key column is emptied", async () => {
    setupJobsFs({ csvBody: csv });
    captureWrites();
    const user = userEvent.setup();
    render(<JobTrackerApp />);

    await user.click(await screen.findByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });
    await user.click(within(panel).getByRole("button", { name: /edit job/i }));

    const dialog = await screen.findByRole("dialog", { name: /edit job/i });
    const id = within(dialog).getByLabelText("id") as HTMLInputElement;
    await user.clear(id);
    await user.click(within(dialog).getByRole("button", { name: /save/i }));
    expect(
      within(dialog).getByText(/id column is required/i),
    ).toBeInTheDocument();
  });
});

describe("JobTrackerApp — attach file", () => {
  beforeEach(() => {
    saveJobTrackerConfig({ rootPath: "/r" });
  });

  it("attaches a file via the picker into <root>/files/<rowKey>/", async () => {
    setupJobsFs({ csvBody: csv });
    let folderCreated = false;
    setInvokeHandler("local_create_folder", (args) => {
      const a = args as { path: string };
      expect(a.path).toBe("/r/files/alpha");
      folderCreated = true;
      return {
        name: "alpha",
        path: a.path,
        isDirectory: true,
        size: null,
        modified: null,
      };
    });
    const copies: Array<{ from: string; to: string }> = [];
    setInvokeHandler("local_copy_file", (args) => {
      const a = args as { fromPath: string; toPath: string };
      copies.push({ from: a.fromPath, to: a.toPath });
      return {
        name: "brief.pdf",
        path: a.toPath,
        isDirectory: false,
        size: 1,
        modified: null,
      };
    });
    // After attach, list_directory for /r/files/alpha returns the file.
    let attached = false;
    setInvokeHandler("list_directory", (args) => {
      const path = (args as { path: string }).path;
      if (path === "/r/files/alpha") {
        if (!attached) throw new Error("Not a directory: " + path);
        return [
          {
            name: "brief.pdf",
            path: "/r/files/alpha/brief.pdf",
            isDirectory: false,
            size: 1,
            modified: null,
          },
        ];
      }
      throw new Error("Not a directory: " + path);
    });
    setNextOpenResult("/elsewhere/brief.pdf");

    const user = userEvent.setup();
    render(<JobTrackerApp />);
    await user.click(await screen.findByText("alpha"));
    const panel = await screen.findByRole("complementary", {
      name: /job detail/i,
    });

    attached = true;
    await user.click(
      within(panel).getByRole("button", { name: /attach file to job/i }),
    );

    await waitFor(() => expect(folderCreated).toBe(true));
    expect(copies).toEqual([
      { from: "/elsewhere/brief.pdf", to: "/r/files/alpha/brief.pdf" },
    ]);
    expect(await within(panel).findByText("brief.pdf")).toBeInTheDocument();
  });
});
