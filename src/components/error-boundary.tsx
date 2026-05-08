import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  /** Label for the section so the message is meaningful (e.g. "Photos"). */
  label?: string;
  /** Optional override for the default fallback UI. */
  fallback?: (state: {
    error: Error;
    reset: () => void;
    label?: string;
  }) => ReactNode;
  /** Notified on capture so the parent can log or report. */
  onError?: (error: Error, info: ErrorInfo) => void;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback({
        error,
        reset: this.reset,
        label: this.props.label,
      });
    }

    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle data-icon="inline-start" />
          <span>
            {this.props.label
              ? `${this.props.label} crashed`
              : "Something went wrong"}
          </span>
        </div>
        <p className="font-mono text-xs break-words">{error.message}</p>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={this.reset}
          >
            <RotateCcw data-icon="inline-start" />
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
