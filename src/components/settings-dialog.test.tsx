import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSettings, loadSettings } from "@/lib/settings";

import { SettingsDialog } from "./settings-dialog";

beforeEach(() => {
  clearSettings();
  document.documentElement.classList.remove("dark");
});
afterEach(() => {
  clearSettings();
  document.documentElement.classList.remove("dark");
});

describe("SettingsDialog", () => {
  it("renders nothing when open=false", () => {
    render(<SettingsDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows current selections as aria-checked when opened", () => {
    render(<SettingsDialog open onClose={() => {}} />);
    // Defaults: theme=system, layout=grid.
    const systemRadio = screen.getByRole("radio", { name: /theme: system/i });
    expect(systemRadio).toHaveAttribute("aria-checked", "true");
    const gridRadio = screen.getByRole("radio", {
      name: /dashboard layout: grid/i,
    });
    expect(gridRadio).toHaveAttribute("aria-checked", "true");
  });

  it("clicking a theme persists immediately and applies the dark class", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={() => {}} />);

    await user.click(screen.getByRole("radio", { name: /theme: dark/i }));

    expect(loadSettings().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("clicking a layout persists immediately", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={() => {}} />);

    await user.click(
      screen.getByRole("radio", { name: /dashboard layout: compact/i }),
    );
    expect(loadSettings().dashboardLayout).toBe("compact");
  });

  it("Esc fires onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click fires onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={onClose} />);
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the inner panel does NOT bubble through to onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={onClose} />);
    // Click an element inside the panel (the Theme heading).
    await user.click(screen.getByText(/^theme$/i));
    expect(onClose).not.toHaveBeenCalled();
  });
});
