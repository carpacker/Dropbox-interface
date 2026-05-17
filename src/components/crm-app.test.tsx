import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearCrmConfig, saveCrmConfig } from "@/lib/crm-config";
import { setInvokeHandler } from "@/test/tauri-core-mock";
import { setNextOpenResult } from "@/test/tauri-dialog-mock";

import { CrmApp } from "./crm-app";

const csv = [
  "id,name,email,company",
  "ada,Ada Lovelace,ada@example.com,Analytical Engines",
  "grace,Grace Hopper,grace@example.com,COBOL Co",
  "linus,Linus Torvalds,linus@example.com,Kernel Inc",
].join("\n");

function setupCrmFs(opts: {
  rootPath: string;
  csvBody?: string;
  filesByRowKey?: Record<string, Array<{ name: string; path?: string }>>;
}) {
  setInvokeHandler("local_read_text_file", (args) => {
    const path = (args as { path: string }).path;
    if (path.endsWith("contacts.csv")) return opts.csvBody ?? null;
    return null;
  });
  setInvokeHandler("list_directory", (args) => {
    const path = (args as { path: string }).path;
    // Per-row files dir requests look like `<root>/files/<key>`.
    const m = path.match(/[/\\]files[/\\]([^/\\]+)$/);
    if (!m) {
      throw new Error(`Not a directory: ${path}`);
    }
    const key = m[1];
    const rows = opts.filesByRowKey?.[key];
    if (!rows) {
      throw new Error(`Not a directory: ${path}`);
    }
    return rows.map((r) => ({
      name: r.name,
      path: r.path ?? `${path}/${r.name}`,
      isDirectory: false,
      size: 100,
      modified: null,
    }));
  });
}

beforeEach(() => clearCrmConfig());
afterEach(() => clearCrmConfig());

describe("CrmApp — setup card", () => {
  it("renders a 'Pick CRM folder' setup card when unconfigured", () => {
    render(<CrmApp />);
    expect(
      screen.getByRole("button", { name: /pick crm folder/i }),
    ).toBeInTheDocument();
  });

  it("after picking a folder with a valid CSV, loads the table", async () => {
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    setNextOpenResult("/r");

    const user = userEvent.setup();
    render(<CrmApp />);

    await user.click(
      screen.getByRole("button", { name: /pick crm folder/i }),
    );
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("Linus Torvalds")).toBeInTheDocument();
  });

  it("auto-loads from saved config on mount", async () => {
    saveCrmConfig({ rootPath: "/r" });
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    render(<CrmApp />);
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
  });
});

describe("CrmApp — error handling", () => {
  it("surfaces 'no contacts.csv' when the file is missing", async () => {
    saveCrmConfig({ rootPath: "/r" });
    // local_read_text_file returns null → missing.
    setInvokeHandler("local_read_text_file", () => null);
    render(<CrmApp />);
    expect(
      await screen.findByText(/no contacts\.csv at \/r\/contacts\.csv/i),
    ).toBeInTheDocument();
  });

  it("shows a parse-error panel for malformed CSV", async () => {
    saveCrmConfig({ rootPath: "/r" });
    setInvokeHandler("local_read_text_file", () => 'x\n"never closed');
    render(<CrmApp />);
    expect(
      await screen.findByText(/could not parse/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/unterminated quoted field/i),
    ).toBeInTheDocument();
  });

  it("surfaces a transient Rust error and offers a 'pick different' escape", async () => {
    saveCrmConfig({ rootPath: "/r" });
    setInvokeHandler("local_read_text_file", () => {
      throw new Error("permission denied");
    });
    render(<CrmApp />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /permission denied/i,
    );
    expect(
      screen.getByRole("button", { name: /pick a different folder/i }),
    ).toBeInTheDocument();
  });
});

describe("CrmApp — table interactions", () => {
  beforeEach(() => {
    saveCrmConfig({ rootPath: "/r" });
    setupCrmFs({ rootPath: "/r", csvBody: csv });
  });

  it("filters rows by free-text across all columns", async () => {
    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.type(screen.getByLabelText(/filter crm/i), "cobol");
    await waitFor(() =>
      expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Linus Torvalds")).not.toBeInTheDocument();
  });

  it("sorts by a header click; second click flips direction", async () => {
    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    // Sort by name (asc by default after first click).
    await user.click(screen.getByRole("button", { name: /sort by name/i }));
    const rowsAsc = screen
      .getAllByRole("row")
      .slice(1) // drop header row
      .map((r) => r.textContent ?? "");
    expect(rowsAsc[0]).toContain("Ada Lovelace");
    expect(rowsAsc[2]).toContain("Linus Torvalds");

    // Flip to desc.
    await user.click(screen.getByRole("button", { name: /sort by name/i }));
    const rowsDesc = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent ?? "");
    expect(rowsDesc[0]).toContain("Linus Torvalds");
    expect(rowsDesc[2]).toContain("Ada Lovelace");
  });

  it("clicking a row opens the detail panel with all fields", async () => {
    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByText("Ada Lovelace"));

    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    expect(within(panel).getByText(/ada@example\.com/i)).toBeInTheDocument();
    expect(within(panel).getByText(/analytical engines/i)).toBeInTheDocument();
  });

  it("detail panel reports 'no files attached' when the sidecar folder is missing", async () => {
    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByText("Ada Lovelace"));
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    await waitFor(() =>
      expect(within(panel).getByText(/no files attached/i)).toBeInTheDocument(),
    );
  });

  it("detail panel lists attachments from <root>/files/<key>/", async () => {
    setupCrmFs({
      rootPath: "/r",
      csvBody: csv,
      filesByRowKey: {
        ada: [
          { name: "headshot.jpg", path: "/r/files/ada/headshot.jpg" },
          { name: "contract.pdf", path: "/r/files/ada/contract.pdf" },
        ],
      },
    });
    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByText("Ada Lovelace"));
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    expect(await within(panel).findByText("headshot.jpg")).toBeInTheDocument();
    expect(within(panel).getByText("contract.pdf")).toBeInTheDocument();
  });

  it("clicking an image attachment opens a preview dialog", async () => {
    setupCrmFs({
      rootPath: "/r",
      csvBody: csv,
      filesByRowKey: {
        ada: [{ name: "headshot.jpg", path: "/r/files/ada/headshot.jpg" }],
      },
    });
    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByText("Ada Lovelace"));
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    await user.click(
      await within(panel).findByRole("button", { name: /preview headshot/i }),
    );
    expect(
      await screen.findByRole("dialog", { name: /preview headshot/i }),
    ).toBeInTheDocument();
  });
});

describe("CrmApp — edge cases", () => {
  it("renders an empty-state when the CSV has only a header row", async () => {
    saveCrmConfig({ rootPath: "/r" });
    setupCrmFs({
      rootPath: "/r",
      csvBody: "id,name,email",
    });
    render(<CrmApp />);
    expect(await screen.findByText(/no rows\b/i)).toBeInTheDocument();
  });

  it("falls back to the first column for row-key when neither id nor name exists", async () => {
    saveCrmConfig({ rootPath: "/r" });
    setupCrmFs({
      rootPath: "/r",
      csvBody: "company,email\nAcme,contact@acme.com",
    });
    render(<CrmApp />);
    expect(await screen.findByText(/keyed by/i)).toHaveTextContent(/company/);
  });

  it("drops rows whose key sanitizes to empty", async () => {
    saveCrmConfig({ rootPath: "/r" });
    setupCrmFs({
      rootPath: "/r",
      csvBody: ["id,name", "...,bad row", "linus,Linus"].join("\n"),
    });
    render(<CrmApp />);
    expect(await screen.findByText("Linus")).toBeInTheDocument();
    expect(screen.queryByText("bad row")).not.toBeInTheDocument();
  });
});
