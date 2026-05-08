import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import { DesktopWorkspaceApp } from "./desktop-workspace-app";

vi.mock("./desktop-terminal", () => ({
  DesktopTerminal: ({ active }: { active: boolean }) => (
    <div data-testid="terminal-stub" data-active={active ? "1" : "0"}>
      stub terminal
    </div>
  ),
}));

describe("DesktopWorkspaceApp", () => {
  it("renders the file browser by default", async () => {
    setInvokeHandler("default_local_root", () => "/home/user");
    setInvokeHandler("list_directory", () => []);
    render(<DesktopWorkspaceApp />);
    expect(
      await screen.findByText(/this folder is empty/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-stub")).not.toBeInTheDocument();
  });

  it("mounts the terminal once the Terminal tab is opened, then keeps it mounted", async () => {
    setInvokeHandler("default_local_root", () => "/home/user");
    setInvokeHandler("list_directory", () => []);

    const user = userEvent.setup();
    render(<DesktopWorkspaceApp />);

    await user.click(screen.getByRole("tab", { name: /desktop shell/i }));
    const stub = await screen.findByTestId("terminal-stub");
    expect(stub).toHaveAttribute("data-active", "1");

    await user.click(screen.getByRole("tab", { name: /file viewer/i }));
    // still mounted after switching back, just inactive
    expect(screen.getByTestId("terminal-stub")).toHaveAttribute(
      "data-active",
      "0",
    );
  });
});
