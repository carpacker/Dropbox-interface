import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./error-boundary";

function Boom({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error("kaboom");
  }
  return <span>safe child</span>;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs errors caught by error boundaries; silence to keep test output clean.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <span>healthy child</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy child")).toBeInTheDocument();
  });

  it("renders fallback UI when a child throws", () => {
    render(
      <ErrorBoundary label="Test section">
        <Boom />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Test section crashed");
    expect(alert).toHaveTextContent("kaboom");
  });

  it("uses generic header when no label is provided", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("calls onError with the error and component info", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [err, info] = onError.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("kaboom");
    expect(info).toHaveProperty("componentStack");
  });

  it("clicking 'Try again' clears the error so children can re-render", async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Toggleable() {
      if (shouldThrow) {
        throw new Error("kaboom");
      }
      return <span>recovered</span>;
    }

    render(
      <ErrorBoundary>
        <Toggleable />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("supports a custom fallback render prop", () => {
    render(
      <ErrorBoundary
        label="Custom"
        fallback={({ error, label }) => (
          <p data-testid="custom">
            {label}: {error.message}
          </p>
        )}
      >
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("custom")).toHaveTextContent("Custom: kaboom");
  });
});
