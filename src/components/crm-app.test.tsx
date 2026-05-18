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

describe("CrmApp — writes", () => {
  beforeEach(() => {
    saveCrmConfig({ rootPath: "/r" });
  });

  function captureWrites() {
    const captured: Array<{ path: string; contents: string }> = [];
    setInvokeHandler("local_write_text_file", (args) => {
      const a = args as { path: string; contents: string };
      captured.push(a);
      return {
        name: "contacts.csv",
        path: a.path,
        isDirectory: false,
        size: a.contents.length,
        modified: null,
      };
    });
    return captured;
  }

  it("adds a new row via the Add row dialog and rewrites the CSV", async () => {
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    const writes = captureWrites();

    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: /add a new row/i }));

    const dialog = await screen.findByRole("dialog", { name: /add row/i });
    await user.type(within(dialog).getByLabelText("id"), "marie");
    await user.type(within(dialog).getByLabelText("name"), "Marie Curie");
    await user.type(within(dialog).getByLabelText("email"), "marie@example.com");
    await user.type(within(dialog).getByLabelText("company"), "Radium Inc");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    expect(await screen.findByText("Marie Curie")).toBeInTheDocument();
    expect(writes.length).toBe(1);
    expect(writes[0].path).toBe("/r/contacts.csv");
    expect(writes[0].contents).toMatch(/marie,Marie Curie/);
  });

  it("refuses to save an add when the key column is empty", async () => {
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    captureWrites();

    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: /add a new row/i }));

    const dialog = await screen.findByRole("dialog", { name: /add row/i });
    // Save with id blank.
    await user.click(within(dialog).getByRole("button", { name: /save/i }));
    expect(
      within(dialog).getByText(/id column is required/i),
    ).toBeInTheDocument();
  });

  it("edits a row in place and persists the updated CSV", async () => {
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    const writes = captureWrites();

    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByText("Ada Lovelace"));
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    await user.click(within(panel).getByRole("button", { name: /edit row/i }));

    const dialog = await screen.findByRole("dialog", { name: /edit row/i });
    const company = within(dialog).getByLabelText("company") as HTMLInputElement;
    await user.clear(company);
    await user.type(company, "Babbage Labs");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    // "Babbage Labs" appears in both the table row and the detail
    // panel echo — just wait for at least one to land.
    await waitFor(() =>
      expect(screen.getAllByText("Babbage Labs").length).toBeGreaterThan(0),
    );
    expect(writes.length).toBe(1);
    expect(writes[0].contents).toMatch(/ada,Ada Lovelace,.*Babbage Labs/);
  });

  it("delete row asks for confirmation, then rewrites the CSV without the row", async () => {
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    const writes = captureWrites();

    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByText("Ada Lovelace"));
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    await user.click(
      within(panel).getByRole("button", { name: /delete row/i }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: /delete this row/i,
    });
    await user.click(within(confirm).getByRole("button", { name: /^delete$/i }));

    // Ada is gone from the table.
    await waitFor(() =>
      expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument(),
    );
    expect(writes.length).toBe(1);
    expect(writes[0].contents).not.toMatch(/Ada Lovelace/);
    expect(writes[0].contents).toMatch(/Grace Hopper/);
  });

  it("delete row cancel does not rewrite the CSV", async () => {
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    const writes = captureWrites();

    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByText("Ada Lovelace"));
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    await user.click(
      within(panel).getByRole("button", { name: /delete row/i }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: /delete this row/i,
    });
    await user.click(within(confirm).getByRole("button", { name: /cancel/i }));

    // Ada still appears at least once (table row + detail panel echo).
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(writes.length).toBe(0);
  });
});

describe("CrmApp — attachments", () => {
  beforeEach(() => {
    saveCrmConfig({ rootPath: "/r" });
  });

  it("attaches a file via the picker: creates the folder if missing, then copies", async () => {
    setupCrmFs({ rootPath: "/r", csvBody: csv });

    let folderCreated = false;
    setInvokeHandler("local_create_folder", (args) => {
      const a = args as { path: string };
      expect(a.path).toBe("/r/files/ada");
      folderCreated = true;
      return {
        name: "ada",
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
        name: "spec.pdf",
        path: a.toPath,
        isDirectory: false,
        size: 1234,
        modified: null,
      };
    });

    // After the copy, list_directory for /r/files/ada returns the
    // attached file. Override the default mock that throws.
    let attached = false;
    setInvokeHandler("list_directory", (args) => {
      const path = (args as { path: string }).path;
      if (path === "/r/files/ada") {
        if (!attached) throw new Error("Not a directory: " + path);
        return [
          {
            name: "spec.pdf",
            path: "/r/files/ada/spec.pdf",
            isDirectory: false,
            size: 1234,
            modified: null,
          },
        ];
      }
      throw new Error("Not a directory: " + path);
    });

    setNextOpenResult("/elsewhere/spec.pdf");
    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByText("Ada Lovelace"));
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });

    attached = true; // next list_directory should return the file.
    await user.click(
      within(panel).getByRole("button", { name: /attach file to row/i }),
    );

    await waitFor(() => expect(folderCreated).toBe(true));
    expect(copies).toEqual([
      { from: "/elsewhere/spec.pdf", to: "/r/files/ada/spec.pdf" },
    ]);
    expect(await within(panel).findByText("spec.pdf")).toBeInTheDocument();
  });

  it("attaching with the folder already present skips creation and still copies", async () => {
    setupCrmFs({
      rootPath: "/r",
      csvBody: csv,
      filesByRowKey: { ada: [] }, // folder exists but empty
    });
    setInvokeHandler("local_create_folder", () => {
      throw new Error("Path already exists: /r/files/ada");
    });
    const copies: Array<{ from: string; to: string }> = [];
    setInvokeHandler("local_copy_file", (args) => {
      const a = args as { fromPath: string; toPath: string };
      copies.push({ from: a.fromPath, to: a.toPath });
      return {
        name: "spec.pdf",
        path: a.toPath,
        isDirectory: false,
        size: 1,
        modified: null,
      };
    });

    setNextOpenResult("/elsewhere/spec.pdf");
    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByText("Ada Lovelace"));
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    await user.click(
      within(panel).getByRole("button", { name: /attach file to row/i }),
    );

    await waitFor(() =>
      expect(copies).toEqual([
        { from: "/elsewhere/spec.pdf", to: "/r/files/ada/spec.pdf" },
      ]),
    );
  });

  it("attach surfaces a Rust-side copy error inline", async () => {
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    setInvokeHandler("local_create_folder", () => ({
      name: "ada",
      path: "/r/files/ada",
      isDirectory: true,
      size: null,
      modified: null,
    }));
    setInvokeHandler("local_copy_file", () => {
      throw new Error("Destination already exists: /r/files/ada/spec.pdf");
    });
    setNextOpenResult("/elsewhere/spec.pdf");

    const user = userEvent.setup();
    render(<CrmApp />);
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByText("Ada Lovelace"));
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    await user.click(
      within(panel).getByRole("button", { name: /attach file to row/i }),
    );
    expect(
      await within(panel).findByText(/destination already exists/i),
    ).toBeInTheDocument();
  });
});

describe("CrmApp — initialRowKey deep-link", () => {
  it("opens the detail panel for the deep-linked row after load", async () => {
    saveCrmConfig({ rootPath: "/r" });
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    render(<CrmApp initialRowKey="ada" />);
    // Detail panel opens automatically once the CSV finishes loading.
    const panel = await screen.findByRole("complementary", {
      name: /row detail/i,
    });
    expect(within(panel).getByText("ada@example.com")).toBeInTheDocument();
  });

  it("is a noop when the deep-linked row isn't present in the CSV", async () => {
    saveCrmConfig({ rootPath: "/r" });
    setupCrmFs({ rootPath: "/r", csvBody: csv });
    render(<CrmApp initialRowKey="not_a_real_row" />);
    // The CSV loads + the table renders, but no detail panel opens.
    await screen.findByText("Ada Lovelace");
    expect(
      screen.queryByRole("complementary", { name: /row detail/i }),
    ).not.toBeInTheDocument();
  });
});
