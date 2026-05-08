import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
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
