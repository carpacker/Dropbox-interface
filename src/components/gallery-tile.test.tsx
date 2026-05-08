import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DropboxEntry } from "@/lib/tauri-dropbox";

import { GalleryTile } from "./gallery-tile";

function entry(over: Partial<DropboxEntry> = {}): DropboxEntry {
  return {
    kind: "file",
    name: "hero.jpg",
    path: "/p/hero.jpg",
    displayPath: "/p/hero.jpg",
    size: 1234,
    serverModified: "2025-01-02T00:00:00Z",
    ...over,
  };
}

describe("GalleryTile", () => {
  it("calls onPreview when an image tile is clicked", async () => {
    const onPreview = vi.fn();
    const loader = vi.fn(async () => "data:image/jpeg;base64,AAA=");
    const user = userEvent.setup();
    render(
      <GalleryTile
        entry={entry()}
        saving={false}
        loadThumbnail={loader}
        onOpenFolder={() => {}}
        onPreview={onPreview}
        onSave={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /preview hero\.jpg/i }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenFolder when a folder tile is clicked", async () => {
    const onOpenFolder = vi.fn();
    const user = userEvent.setup();
    render(
      <GalleryTile
        entry={entry({ kind: "folder", name: "drafts", path: "/p/drafts" })}
        saving={false}
        loadThumbnail={vi.fn()}
        onOpenFolder={onOpenFolder}
        onPreview={() => {}}
        onSave={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /open folder drafts/i }));
    expect(onOpenFolder).toHaveBeenCalledWith("/p/drafts");
  });

  it("loads + renders the w256h256 thumbnail for image tiles", async () => {
    const loader = vi.fn(async () => "data:image/jpeg;base64,AAA=");
    render(
      <GalleryTile
        entry={entry()}
        saving={false}
        loadThumbnail={loader}
        onOpenFolder={() => {}}
        onPreview={() => {}}
        onSave={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("gallery-thumbnail-/p/hero.jpg")).toBeInTheDocument(),
    );
    expect(loader).toHaveBeenCalledWith("/p/hero.jpg", "w256h256");
  });

  it("falls back to a file icon when the thumbnail loader rejects", async () => {
    const loader = vi.fn(async () => {
      throw new Error("boom");
    });
    render(
      <GalleryTile
        entry={entry()}
        saving={false}
        loadThumbnail={loader}
        onOpenFolder={() => {}}
        onPreview={() => {}}
        onSave={() => {}}
      />,
    );
    await waitFor(() => expect(loader).toHaveBeenCalled());
    // No <img> rendered when the loader fails — fallback icon renders.
    expect(
      screen.queryByTestId("gallery-thumbnail-/p/hero.jpg"),
    ).not.toBeInTheDocument();
  });

  it("does not load a thumbnail for non-image files", () => {
    const loader = vi.fn();
    render(
      <GalleryTile
        entry={entry({ name: "notes.txt", path: "/p/notes.txt" })}
        saving={false}
        loadThumbnail={loader}
        onOpenFolder={() => {}}
        onPreview={() => {}}
        onSave={() => {}}
      />,
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it("renders the promote / save / delete affordances when supplied", async () => {
    const onPromote = vi.fn();
    const onSave = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <GalleryTile
        entry={entry()}
        saving={false}
        loadThumbnail={vi.fn(async () => "data:image/png;base64,A=")}
        onOpenFolder={() => {}}
        onPreview={() => {}}
        onSave={onSave}
        promote={{
          targetStateName: "Ready",
          inFlight: false,
          onClick: onPromote,
        }}
        delete={{ inFlight: false, onClick: onDelete }}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /promote hero\.jpg to ready/i }),
    );
    expect(onPromote).toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: /save hero\.jpg to disk/i }),
    );
    expect(onSave).toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: /delete hero\.jpg/i }),
    );
    expect(onDelete).toHaveBeenCalled();
  });

  it("shows the note indicator dot when hasNote is true", () => {
    render(
      <GalleryTile
        entry={entry()}
        saving={false}
        loadThumbnail={vi.fn(async () => "data:,")}
        onOpenFolder={() => {}}
        onPreview={() => {}}
        onSave={() => {}}
        note={{ hasNote: true, onClick: () => {} }}
      />,
    );
    expect(
      screen.getByTestId("note-indicator-/p/hero.jpg"),
    ).toBeInTheDocument();
  });

  it("does not render Save for folder tiles", () => {
    render(
      <GalleryTile
        entry={entry({ kind: "folder", name: "f", path: "/p/f" })}
        saving={false}
        loadThumbnail={vi.fn()}
        onOpenFolder={() => {}}
        onPreview={() => {}}
        onSave={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /save .* to disk/i }),
    ).not.toBeInTheDocument();
  });

  it("mirrors the focused prop to a data-attribute (for keyboard nav)", () => {
    const { container } = render(
      <GalleryTile
        entry={entry()}
        saving={false}
        loadThumbnail={vi.fn(async () => "data:,")}
        onOpenFolder={() => {}}
        onPreview={() => {}}
        onSave={() => {}}
        focused
      />,
    );
    expect(container.querySelector("[data-focused='true']")).not.toBeNull();
  });
});
