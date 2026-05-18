import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import {
  addRecentPipeline,
  clearRecentPipelines,
} from "@/lib/pipeline-recents";
import App from "./App";

vi.mock("@/components/desktop-terminal", () => ({
  DesktopTerminal: () => <div data-testid="terminal-stub">stub</div>,
}));

beforeEach(() => {
  vi.stubEnv("VITE_DROPBOX_APP_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("App", () => {
  it("starts on the dashboard rendering one card per registered app", () => {
    render(<App />);
    // Cards are driven by the registry — one launch button per app.
    expect(
      screen.getByRole("button", { name: /launch workspace app/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open photo app/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open dropbox/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open crm/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open job tracker/i }),
    ).toBeInTheDocument();
  });

  it("navigates into the workspace app and back", async () => {
    setInvokeHandler("default_local_root", () => "/home/user");
    setInvokeHandler("list_directory", () => []);

    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /launch workspace app/i }),
    );
    expect(await screen.findByRole("tab", { name: /file viewer/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to dashboard/i }));
    expect(
      screen.getByRole("button", { name: /launch workspace app/i }),
    ).toBeInTheDocument();
  });

  it("navigates into the photos app", async () => {
    setInvokeHandler("default_local_root", () => "/home/user");
    setInvokeHandler("list_directory", () => []);

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /open photo app/i }));
    expect(await screen.findByText("Photo browser")).toBeInTheDocument();
  });

  it("navigates into the Dropbox app", async () => {
    setInvokeHandler("dropbox_status", () => null);

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /open dropbox/i }));
    expect(
      await screen.findByRole("button", { name: /connect dropbox/i }),
    ).toBeInTheDocument();
  });
});

describe("App — Recent pipelines card", () => {
  beforeEach(() => {
    clearRecentPipelines();
  });

  it("does not render the card when no recents are stored", () => {
    render(<App />);
    expect(
      screen.queryByLabelText(/recent pipelines/i),
    ).not.toBeInTheDocument();
  });

  it("renders one button per recent pipeline with the friendly name and path", () => {
    addRecentPipeline({ path: "/ARTISTS/foo", name: "Foo review" }, () => 1000);
    addRecentPipeline(
      { path: "/SOCIAL/queue", name: "Social queue" },
      () => 2000,
    );

    render(<App />);

    const list = screen.getByLabelText(/recent pipelines/i);
    // Two row-body buttons (one per recent) + two pin toggles.
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // MRU first: Social queue (2000) before Foo review (1000).
    expect(items[0]).toHaveTextContent(/Social queue/);
    expect(items[0]).toHaveTextContent(/\/SOCIAL\/queue/);
    expect(items[1]).toHaveTextContent(/Foo review/);
    expect(within(items[0]).getByRole("button", { name: /pin social queue/i })).toBeInTheDocument();
  });

  it("clicking a recent navigates straight into the Dropbox app at that path", async () => {
    addRecentPipeline({ path: "/ARTISTS/foo", name: "Foo review" });
    setInvokeHandler("dropbox_status", () => ({
      accountId: "id",
      displayName: "X",
      email: "y@z",
    }));
    const listings: Record<string, unknown[]> = {
      "/ARTISTS/foo": [],
    };
    setInvokeHandler("dropbox_list_folder", (args) => {
      const path = (args as { path: string }).path;
      const rows = listings[path];
      if (!rows) throw new Error(`no listing for ${path}`);
      return rows;
    });
    setInvokeHandler("dropbox_read_text_file", () => null);

    const user = userEvent.setup();
    render(<App />);

    // Click the row body, not the pin toggle.
    const list = screen.getByLabelText(/recent pipelines/i);
    const [row] = within(list).getAllByRole("listitem");
    await user.click(within(row).getByRole("button", { name: /^Foo review/ }));
    // Confirm we landed on the Dropbox view (account header is visible)
    expect(await screen.findByText(/Dropbox · X/i)).toBeInTheDocument();
    // ...and that the path bar shows the recent's path, not root.
    expect(screen.getByLabelText(/current dropbox path/i)).toHaveTextContent(
      "/ARTISTS/foo",
    );
  });

  it("clicking a recent's pin toggle persists pinned status without navigating", async () => {
    addRecentPipeline({ path: "/A", name: "Alpha" });

    const user = userEvent.setup();
    render(<App />);

    const list = screen.getByLabelText(/recent pipelines/i);
    await user.click(within(list).getByRole("button", { name: /pin alpha/i }));

    // Still on dashboard; row toggled to pinned and exposes Unpin label.
    expect(
      within(list).getByRole("button", { name: /unpin alpha/i }),
    ).toBeInTheDocument();
    // Underlying storage now flags the entry as pinned.
    const stored = JSON.parse(
      localStorage.getItem("dropbox-interface:recent-pipelines")!,
    );
    expect(stored[0]).toMatchObject({ path: "/A", pinned: true });
  });

  it("re-reads the recents list when returning to the dashboard", async () => {
    setInvokeHandler("dropbox_status", () => null);

    const user = userEvent.setup();
    render(<App />);

    // No recents on first dashboard render.
    expect(
      screen.queryByLabelText(/recent pipelines/i),
    ).not.toBeInTheDocument();

    // Bounce into Dropbox and back; while there, simulate a pipeline visit.
    await user.click(screen.getByRole("button", { name: /open dropbox/i }));
    addRecentPipeline({ path: "/ARTISTS/bar", name: "Bar review" });
    await user.click(screen.getByRole("button", { name: /back to dashboard/i }));

    // Now the card appears on the dashboard.
    expect(screen.getByLabelText(/recent pipelines/i)).toBeInTheDocument();
    expect(screen.getByText(/Bar review/)).toBeInTheDocument();
  });

  afterEach(() => {
    clearRecentPipelines();
  });
});

describe("App — Recent CRMs card", () => {
  beforeEach(() => {
    // Wipe both recents tables; the dashboard reads from each.
    localStorage.removeItem("dropbox-interface:crm:recents:v1");
  });
  afterEach(() => {
    localStorage.removeItem("dropbox-interface:crm:recents:v1");
  });

  it("does not render the CRM recents card when none are stored", () => {
    render(<App />);
    expect(
      screen.queryByLabelText(/recent crms/i),
    ).not.toBeInTheDocument();
  });

  it("renders one row per stored CRM, MRU first, with a pin toggle", async () => {
    localStorage.setItem(
      "dropbox-interface:crm:recents:v1",
      JSON.stringify([
        { path: "/old/crm", name: "Old", visitedAt: 1000 },
        { path: "/new/crm", name: "New", visitedAt: 2000 },
      ]),
    );
    render(<App />);
    const list = await screen.findByLabelText(/recent crms/i);
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // MRU first.
    expect(items[0]).toHaveTextContent("New");
    expect(items[1]).toHaveTextContent("Old");
    expect(
      within(items[0]).getByRole("button", { name: /pin new/i }),
    ).toBeInTheDocument();
  });

  it("clicking a recent CRM enters the CRM app", async () => {
    localStorage.setItem(
      "dropbox-interface:crm:recents:v1",
      JSON.stringify([
        { path: "/r", name: "R", visitedAt: 1000 },
      ]),
    );
    // CRM mount will try to read the CSV at /r/contacts.csv — return
    // a minimal valid file so the table renders.
    setInvokeHandler("local_read_text_file", () => "id,name\nx,X\n");
    setInvokeHandler("list_directory", () => {
      throw new Error("Not a directory: /r/files/x");
    });

    const user = userEvent.setup();
    render(<App />);
    const list = await screen.findByLabelText(/recent crms/i);
    const [row] = within(list).getAllByRole("listitem");
    await user.click(within(row).getByRole("button", { name: /^R/ }));

    // CRM table renders the row from the CSV.
    expect(await screen.findByText("X")).toBeInTheDocument();
  });
});

describe("App — Recent Job Trackers card", () => {
  beforeEach(() => {
    localStorage.removeItem("dropbox-interface:job-tracker:recents:v1");
  });
  afterEach(() => {
    localStorage.removeItem("dropbox-interface:job-tracker:recents:v1");
  });

  it("does not render the card when no recents are stored", () => {
    render(<App />);
    expect(
      screen.queryByLabelText(/recent job trackers/i),
    ).not.toBeInTheDocument();
  });

  it("renders one row per stored Job Tracker, MRU first", async () => {
    localStorage.setItem(
      "dropbox-interface:job-tracker:recents:v1",
      JSON.stringify([
        { path: "/old/jt", name: "OldJT", visitedAt: 1000 },
        { path: "/new/jt", name: "NewJT", visitedAt: 2000 },
      ]),
    );
    render(<App />);
    const list = await screen.findByLabelText(/recent job trackers/i);
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("NewJT");
    expect(items[1]).toHaveTextContent("OldJT");
  });

  it("clicking a recent Job Tracker enters the app at that path", async () => {
    localStorage.setItem(
      "dropbox-interface:job-tracker:recents:v1",
      JSON.stringify([
        { path: "/r", name: "R", visitedAt: 1000 },
      ]),
    );
    // Job Tracker reads <root>/jobs.csv on launch.
    setInvokeHandler("local_read_text_file", (args) => {
      const path = (args as { path: string }).path;
      if (path.endsWith("jobs.csv")) return "id,status\nfoo,Booked\n";
      return null;
    });

    const user = userEvent.setup();
    render(<App />);
    const list = await screen.findByLabelText(/recent job trackers/i);
    const [row] = within(list).getAllByRole("listitem");
    await user.click(within(row).getByRole("button", { name: /^R/ }));

    // The Job Tracker board renders the row's column.
    expect(
      await screen.findByLabelText(/status: booked/i),
    ).toBeInTheDocument();
  });
});

// formatRelativeTime tests live in src/lib/time-format.test.ts now.
