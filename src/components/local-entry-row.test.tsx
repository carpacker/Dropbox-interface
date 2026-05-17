import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PipelineEntry } from "@/lib/pipeline/entry";

import { LocalEntryRow } from "./local-entry-row";

function entry(over: Partial<PipelineEntry> = {}): PipelineEntry {
  return {
    kind: "file",
    name: "notes.txt",
    path: "/parent/notes.txt",
    displayPath: "/parent/notes.txt",
    size: 12,
    serverModified: "2025-01-02T00:00:00Z",
    ...over,
  };
}

describe("LocalEntryRow", () => {
  it("calls onOpenFolder when clicking a folder row", async () => {
    const onOpenFolder = vi.fn();
    const user = userEvent.setup();
    render(
      <LocalEntryRow
        entry={entry({ kind: "folder", name: "drafts", path: "/p/drafts" })}
        onOpenFolder={onOpenFolder}
      />,
    );
    await user.click(screen.getByRole("button", { name: /open folder drafts/i }));
    expect(onOpenFolder).toHaveBeenCalledWith("/p/drafts");
  });

  it("disables the main button for files (file rows aren't openable)", () => {
    render(<LocalEntryRow entry={entry()} onOpenFolder={() => {}} />);
    expect(screen.getByRole("button", { name: "notes.txt" })).toBeDisabled();
  });

  it("renders Promote when supplied and triggers the callback", async () => {
    const onPromote = vi.fn();
    const user = userEvent.setup();
    render(
      <LocalEntryRow
        entry={entry()}
        onOpenFolder={() => {}}
        promote={{
          targetStateName: "Ready",
          inFlight: false,
          onClick: onPromote,
        }}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /promote notes\.txt to ready/i }),
    );
    expect(onPromote).toHaveBeenCalled();
  });

  it("disables Promote while inFlight and switches label to Moving…", () => {
    render(
      <LocalEntryRow
        entry={entry()}
        onOpenFolder={() => {}}
        promote={{
          targetStateName: "Ready",
          inFlight: true,
          onClick: () => {},
        }}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /promote notes\.txt to ready/i,
    });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/moving/i);
  });

  it("renders a multi-select checkbox when select is supplied", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <LocalEntryRow
        entry={entry()}
        onOpenFolder={() => {}}
        select={{ selected: false, onToggle }}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: /select notes\.txt/i }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("renders a note indicator dot when hasNote is true", () => {
    render(
      <LocalEntryRow
        entry={entry()}
        onOpenFolder={() => {}}
        note={{ hasNote: true, onClick: () => {} }}
      />,
    );
    expect(
      screen.getByTestId("note-indicator-/parent/notes.txt"),
    ).toBeInTheDocument();
  });
});
