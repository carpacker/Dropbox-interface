import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PipelineEntry } from "@/lib/pipeline/entry";

import { BrowserTile } from "./browser-tile";

function entry(over: Partial<PipelineEntry> = {}): PipelineEntry {
  return {
    kind: "file",
    name: "doc.pdf",
    path: "/p/doc.pdf",
    displayPath: "/p/doc.pdf",
    size: 4096,
    serverModified: "2025-01-02T00:00:00Z",
    ...over,
  };
}

describe("BrowserTile", () => {
  it("calls onOpenFolder for a folder tile click", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <BrowserTile
        entry={entry({ kind: "folder", name: "Photos", path: "/p/Photos" })}
        isImage={false}
        loadThumbnail={vi.fn()}
        onOpenFolder={onOpen}
        onPreview={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /open folder photos/i }));
    expect(onOpen).toHaveBeenCalledWith("/p/Photos");
  });

  it("calls onPreview for an image tile click", async () => {
    const onPreview = vi.fn();
    const user = userEvent.setup();
    render(
      <BrowserTile
        entry={entry({ name: "shot.jpg", path: "/p/shot.jpg" })}
        isImage
        loadThumbnail={vi.fn(async () => "data:,")}
        onOpenFolder={() => {}}
        onPreview={onPreview}
      />,
    );
    await user.click(screen.getByRole("button", { name: /preview shot\.jpg/i }));
    expect(onPreview).toHaveBeenCalled();
  });

  it("disables the main button for a non-image file", () => {
    render(
      <BrowserTile
        entry={entry()}
        isImage={false}
        loadThumbnail={vi.fn()}
        onOpenFolder={() => {}}
        onPreview={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "doc.pdf" })).toBeDisabled();
  });

  it("renders the file extension chip on plain-file tiles", () => {
    render(
      <BrowserTile
        entry={entry({ name: "report.pdf" })}
        isImage={false}
        loadThumbnail={vi.fn()}
        onOpenFolder={() => {}}
        onPreview={() => {}}
      />,
    );
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });

  it("renders 'FILE' for extensionless filenames", () => {
    render(
      <BrowserTile
        entry={entry({ name: "README" })}
        isImage={false}
        loadThumbnail={vi.fn()}
        onOpenFolder={() => {}}
        onPreview={() => {}}
      />,
    );
    expect(screen.getByText("FILE")).toBeInTheDocument();
  });

  it("loads + renders an image thumbnail when isImage", async () => {
    const loader = vi.fn(async () => "data:image/jpeg;base64,AAA=");
    render(
      <BrowserTile
        entry={entry({ name: "x.jpg", path: "/p/x.jpg" })}
        isImage
        loadThumbnail={loader}
        onOpenFolder={() => {}}
        onPreview={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("browser-thumbnail-/p/x.jpg")).toBeInTheDocument(),
    );
    expect(loader).toHaveBeenCalled();
  });

  it("does not invoke the loader on a non-image", () => {
    const loader = vi.fn();
    render(
      <BrowserTile
        entry={entry()}
        isImage={false}
        loadThumbnail={loader}
        onOpenFolder={() => {}}
        onPreview={() => {}}
      />,
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it("falls back to a file icon when the thumbnail loader rejects", async () => {
    const loader = vi.fn(async () => {
      throw new Error("boom");
    });
    render(
      <BrowserTile
        entry={entry({ name: "broken.jpg", path: "/p/broken.jpg" })}
        isImage
        loadThumbnail={loader}
        onOpenFolder={() => {}}
        onPreview={() => {}}
      />,
    );
    await waitFor(() => expect(loader).toHaveBeenCalled());
    expect(
      screen.queryByTestId("browser-thumbnail-/p/broken.jpg"),
    ).not.toBeInTheDocument();
  });

  it("renders caller-supplied actions slot", () => {
    render(
      <BrowserTile
        entry={entry()}
        isImage={false}
        loadThumbnail={vi.fn()}
        onOpenFolder={() => {}}
        onPreview={() => {}}
        actions={<button data-testid="custom-action">do</button>}
      />,
    );
    expect(screen.getByTestId("custom-action")).toBeInTheDocument();
  });
});
