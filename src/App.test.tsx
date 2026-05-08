import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import {
  addRecentPipeline,
  clearRecentPipelines,
} from "@/lib/pipeline-recents";
import App, { formatRelativeTime } from "./App";

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
  it("starts on the dashboard with all three app cards", () => {
    render(<App />);
    expect(screen.getByText("Desktop Workspace")).toBeInTheDocument();
    expect(screen.getByText("Photo Viewer")).toBeInTheDocument();
    expect(screen.getByText("Dropbox")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /launch workspace app/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open photo app/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open dropbox/i }),
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
    const items = within(list).getAllByRole("button");
    expect(items).toHaveLength(2);
    // MRU first.
    expect(items[0]).toHaveTextContent(/Social queue/);
    expect(items[0]).toHaveTextContent(/\/SOCIAL\/queue/);
    expect(items[1]).toHaveTextContent(/Foo review/);
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

    await user.click(
      screen.getByRole("button", { name: /Foo review/ }),
    );
    // Confirm we landed on the Dropbox view (account header is visible)
    expect(await screen.findByText(/Dropbox · X/i)).toBeInTheDocument();
    // ...and that the path bar shows the recent's path, not root.
    expect(screen.getByLabelText(/current dropbox path/i)).toHaveTextContent(
      "/ARTISTS/foo",
    );
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

describe("formatRelativeTime", () => {
  it.each([
    [0, "just now"],
    [10_000, "just now"],
    [60_000, "1m ago"],
    [120_000, "2m ago"],
    [60 * 60 * 1000, "1h ago"],
    [3 * 60 * 60 * 1000, "3h ago"],
    [24 * 60 * 60 * 1000, "1d ago"],
    [10 * 24 * 60 * 60 * 1000, "10d ago"],
    [40 * 24 * 60 * 60 * 1000, "1mo ago"],
    [365 * 24 * 60 * 60 * 1000 + 1, "1y ago"],
  ])("delta %i ms → %s", (delta, expected) => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - delta, now)).toBe(expected);
  });

  it("clamps negative deltas to 'just now'", () => {
    expect(formatRelativeTime(2000, 1000)).toBe("just now");
  });
});
