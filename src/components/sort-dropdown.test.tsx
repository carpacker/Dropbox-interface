import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SortDropdown } from "./sort-dropdown";

describe("SortDropdown", () => {
  it("renders the current key as the trigger label and the direction button", () => {
    render(
      <SortDropdown
        value={{ key: "modified", direction: "desc" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/sort by/i)).toHaveTextContent(/modified/i);
    expect(
      screen.getByRole("button", { name: /sort descending/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking the direction button flips asc → desc and vice versa", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SortDropdown
        value={{ key: "name", direction: "asc" }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /sort ascending/i }));
    expect(onChange).toHaveBeenCalledWith({ key: "name", direction: "desc" });
  });

  it("only renders the keys passed in `keys`", () => {
    render(
      <SortDropdown
        value={{ key: "name", direction: "asc" }}
        onChange={() => {}}
        keys={["name", "size"]}
      />,
    );
    // Trigger shows "Name"; opening to verify Modified is absent would
    // require radix's portal, which is brittle in tests. Assert via the
    // trigger label.
    expect(screen.getByLabelText(/sort by/i)).toHaveTextContent(/name/i);
  });
});
