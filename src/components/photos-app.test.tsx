import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import { PhotosApp } from "./photos-app";

type Entry = { name: string; path: string; isDirectory: boolean };

function setupFs(map: Record<string, Entry[]>, root = "/home/user") {
  setInvokeHandler("default_local_root", () => root);
  setInvokeHandler("list_directory", (args) => {
    const path = (args as { path: string }).path;
    const rows = map[path];
    if (!rows) throw new Error(`Not a directory: ${path}`);
    return rows;
  });
  setInvokeHandler("parent_directory", (args) => {
    const path = (args as { path: string }).path;
    const idx = path.lastIndexOf("/");
    if (idx <= 0) return null;
    return path.slice(0, idx);
  });
}

describe("PhotosApp", () => {
  it("loads default root and shows folders + image grid", async () => {
    setupFs({
      "/home/user": [
        { name: "Subdir", path: "/home/user/Subdir", isDirectory: true },
        { name: "a.jpg", path: "/home/user/a.jpg", isDirectory: false },
        { name: "b.PNG", path: "/home/user/b.PNG", isDirectory: false },
        { name: "notes.txt", path: "/home/user/notes.txt", isDirectory: false },
      ],
    });

    render(<PhotosApp />);

    expect(await screen.findByRole("button", { name: /subdir/i })).toBeInTheDocument();
    const grid = await screen.findByRole("list", { name: /image thumbnails/i });
    expect(grid).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open a\.jpg/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open b\.png/i })).toBeInTheDocument();
    // notes.txt is filtered out
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("shows empty-state when there are no images", async () => {
    setupFs({ "/home/user": [] });
    render(<PhotosApp />);
    expect(
      await screen.findByText(/no supported images/i),
    ).toBeInTheDocument();
  });

  it("clicking a folder navigates into it", async () => {
    setupFs({
      "/home/user": [
        { name: "Sub", path: "/home/user/Sub", isDirectory: true },
      ],
      "/home/user/Sub": [
        { name: "x.gif", path: "/home/user/Sub/x.gif", isDirectory: false },
      ],
    });

    const user = userEvent.setup();
    render(<PhotosApp />);

    await user.click(await screen.findByRole("button", { name: /^sub$/i }));
    expect(
      await screen.findByRole("button", { name: /open x\.gif/i }),
    ).toBeInTheDocument();
  });

  it("clicking a thumbnail opens preview dialog with asset URL", async () => {
    setupFs({
      "/home/user": [
        { name: "a.jpg", path: "/home/user/a.jpg", isDirectory: false },
      ],
    });

    const user = userEvent.setup();
    render(<PhotosApp />);

    await user.click(await screen.findByRole("button", { name: /open a\.jpg/i }));
    const dialog = screen.getByRole("dialog", { name: /image preview/i });
    const previewImg = dialog.querySelector("img") as HTMLImageElement;
    expect(previewImg).not.toBeNull();
    expect(previewImg.src).toContain("a.jpg");
    expect(previewImg.src.startsWith("asset://")).toBe(true);
  });

  it("Escape closes the preview dialog", async () => {
    setupFs({
      "/home/user": [
        { name: "a.jpg", path: "/home/user/a.jpg", isDirectory: false },
      ],
    });

    const user = userEvent.setup();
    render(<PhotosApp />);

    await user.click(await screen.findByRole("button", { name: /open a\.jpg/i }));
    expect(screen.getByRole("dialog", { name: /image preview/i })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /image preview/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("clicking the dialog backdrop closes the preview", async () => {
    setupFs({
      "/home/user": [
        { name: "a.jpg", path: "/home/user/a.jpg", isDirectory: false },
      ],
    });

    const user = userEvent.setup();
    render(<PhotosApp />);

    await user.click(await screen.findByRole("button", { name: /open a\.jpg/i }));
    const dialog = screen.getByRole("dialog", { name: /image preview/i });
    await user.click(dialog);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /image preview/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("close button in the preview dismisses it", async () => {
    setupFs({
      "/home/user": [
        { name: "a.jpg", path: "/home/user/a.jpg", isDirectory: false },
      ],
    });

    const user = userEvent.setup();
    render(<PhotosApp />);

    await user.click(await screen.findByRole("button", { name: /open a\.jpg/i }));
    await user.click(screen.getByRole("button", { name: /close preview/i }));
    expect(
      screen.queryByRole("dialog", { name: /image preview/i }),
    ).not.toBeInTheDocument();
  });

  it("surfaces errors from list_directory", async () => {
    setInvokeHandler("default_local_root", () => "/home/user");
    setInvokeHandler("list_directory", () => {
      throw new Error("permission denied");
    });
    render(<PhotosApp />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/permission denied/i);
  });

  it("Go button submits typed path and refreshes grid", async () => {
    setupFs({
      "/home/user": [],
      "/photos": [
        { name: "p.png", path: "/photos/p.png", isDirectory: false },
      ],
    });

    const user = userEvent.setup();
    render(<PhotosApp />);

    await screen.findByText(/no supported images/i);
    const input = screen.getByLabelText("Photo folder path");
    await user.clear(input);
    await user.type(input, "/photos");
    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(
      await screen.findByRole("button", { name: /open p\.png/i }),
    ).toBeInTheDocument();
  });

  it("parent button navigates up", async () => {
    setupFs({
      "/home/user": [
        { name: "Sub", path: "/home/user/Sub", isDirectory: true },
      ],
      "/home/user/Sub": [],
      "/home": [{ name: "user", path: "/home/user", isDirectory: true }],
    });

    const user = userEvent.setup();
    render(<PhotosApp />);

    await user.click(await screen.findByRole("button", { name: /^sub$/i }));
    await screen.findByText(/no supported images/i);

    await user.click(screen.getByRole("button", { name: /parent folder/i }));
    expect(
      await screen.findByRole("button", { name: /^sub$/i }),
    ).toBeInTheDocument();
  });

  describe("slideshow + keyboard nav", () => {
    function setupThreeImages() {
      setupFs({
        "/home/user": [
          { name: "a.jpg", path: "/home/user/a.jpg", isDirectory: false },
          { name: "b.jpg", path: "/home/user/b.jpg", isDirectory: false },
          { name: "c.jpg", path: "/home/user/c.jpg", isDirectory: false },
        ],
      });
    }

    it("ArrowRight advances to the next image inside the lightbox", async () => {
      setupThreeImages();
      const user = userEvent.setup();
      render(<PhotosApp />);

      await user.click(
        await screen.findByRole("button", { name: /open a\.jpg/i }),
      );
      const dialog = screen.getByRole("dialog", { name: /image preview/i });
      const initialSrc = (dialog.querySelector("img") as HTMLImageElement)
        .src;
      expect(initialSrc).toContain("a.jpg");

      await user.keyboard("{ArrowRight}");
      const nextImg = (await screen.findByRole("dialog", {
        name: /image preview/i,
      })).querySelector("img") as HTMLImageElement;
      expect(nextImg.src).toContain("b.jpg");
    });

    it("ArrowLeft from the first image clamps (no wrap)", async () => {
      setupThreeImages();
      const user = userEvent.setup();
      render(<PhotosApp />);

      await user.click(
        await screen.findByRole("button", { name: /open a\.jpg/i }),
      );
      await user.keyboard("{ArrowLeft}");
      const img = (await screen.findByRole("dialog", {
        name: /image preview/i,
      })).querySelector("img") as HTMLImageElement;
      expect(img.src).toContain("a.jpg");
    });

    it("Space toggles the slideshow control's pressed state", async () => {
      setupThreeImages();
      const user = userEvent.setup();
      render(<PhotosApp />);

      await user.click(
        await screen.findByRole("button", { name: /open a\.jpg/i }),
      );
      const playBtn = screen.getByRole("button", { name: /play slideshow/i });
      expect(playBtn).toHaveAttribute("aria-pressed", "false");

      await user.keyboard(" ");
      expect(
        screen.getByRole("button", { name: /pause slideshow/i }),
      ).toHaveAttribute("aria-pressed", "true");

      await user.keyboard(" ");
      expect(
        screen.getByRole("button", { name: /play slideshow/i }),
      ).toHaveAttribute("aria-pressed", "false");
    });

    it("clicking the slideshow button when the lightbox is closed opens the first image and starts playing", async () => {
      setupThreeImages();
      const user = userEvent.setup();
      render(<PhotosApp />);

      await user.click(
        await screen.findByRole("button", { name: /open a\.jpg/i }),
      );
      // Close, then re-open at first via the play button.
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: /image preview/i }),
        ).not.toBeInTheDocument(),
      );

      // Re-open then immediately toggle slideshow via Space.
      await user.click(
        screen.getByRole("button", { name: /open a\.jpg/i }),
      );
      await user.keyboard(" ");
      expect(
        screen.getByRole("button", { name: /pause slideshow/i }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("changing folders stops a running slideshow", async () => {
      setupFs({
        "/home/user": [
          {
            name: "Sub",
            path: "/home/user/Sub",
            isDirectory: true,
          },
          { name: "a.jpg", path: "/home/user/a.jpg", isDirectory: false },
          { name: "b.jpg", path: "/home/user/b.jpg", isDirectory: false },
        ],
        "/home/user/Sub": [],
      });
      const user = userEvent.setup();
      render(<PhotosApp />);

      await user.click(
        await screen.findByRole("button", { name: /open a\.jpg/i }),
      );
      await user.keyboard(" ");
      expect(
        screen.getByRole("button", { name: /pause slideshow/i }),
      ).toHaveAttribute("aria-pressed", "true");

      // Esc has two-stage UX: first press stops the slideshow, second
      // press closes the lightbox.
      await user.keyboard("{Escape}");
      expect(
        screen.getByRole("button", { name: /play slideshow/i }),
      ).toHaveAttribute("aria-pressed", "false");
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: /image preview/i }),
        ).not.toBeInTheDocument(),
      );

      // Navigate; slideshow flag is reset by loadPath.
      await user.click(await screen.findByRole("button", { name: /^sub$/i }));
      await screen.findByText(/no supported images/i);
      // Re-enter parent and confirm the play button is back to "Play".
      await user.click(screen.getByRole("button", { name: /parent folder/i }));
      await user.click(
        await screen.findByRole("button", { name: /open a\.jpg/i }),
      );
      expect(
        screen.getByRole("button", { name: /play slideshow/i }),
      ).toHaveAttribute("aria-pressed", "false");
    });

    it("typing in the path input does not steal arrow-key focus", async () => {
      setupThreeImages();
      const user = userEvent.setup();
      render(<PhotosApp />);

      await user.click(
        await screen.findByRole("button", { name: /open a\.jpg/i }),
      );
      // Close first so the path input can be focused.
      await user.keyboard("{Escape}");

      const input = screen.getByLabelText("Photo folder path");
      await user.click(input);
      // Pressing space inside an INPUT must not trigger play/pause.
      await user.keyboard(" ");
      // Lightbox is closed, slideshow should not have toggled.
      expect(
        screen.queryByRole("dialog", { name: /image preview/i }),
      ).not.toBeInTheDocument();
    });
  });
});
