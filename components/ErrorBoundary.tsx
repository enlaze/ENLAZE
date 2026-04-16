"use client";

import React, { ReactNode, ErrorInfo } from "react";
import { logError, formatErrorForUI } from "@/lib/error-handler";
import ErrorAlert from "./ErrorAlert";

/* ─────────────────────────────────────────────────────────────────────
 *  ErrorBoundary — Reusable error boundary for sections
 *
 *  Catches errors in child components and displays a fallback UI.
 *  Use to wrap sections of the app that might fail independently.
 * ───────────────────────────────────────────────────────────────────── */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Component/section name for logging */
  name?: string;
  /** Show detailed error message (dev only) */
  showDetails?: boolean;
  /** Custom fallback UI */
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to console and error tracking
    logError(error, {
      component: this.props.name,
      context: {
        componentStack: errorInfo.componentStack,
      },
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const error = this.state.error || new Error("Unknown error");

    // Custom fallback
    if (this.props.fallback) {
      return this.props.fallback(error, this.handleReset);
    }

    // Default fallback UI
    const formatted = formatErrorForUI(error);

    return (
      <div className="space-y-4">
        <ErrorAlert
          title={formatted.title}
          message={formatted.message}
          variant={formatted.icon === "error" ? "error" : formatted.icon === "warning" ? "warning" : "info"}
          action={{
            label: "Intentar de nuevo",
            onClick: this.handleReset,
          }}
        />

        {/* Show error details in development */}
        {process.env.NODE_ENV === "development" && this.props.showDetails && (
          <details className="rounded-lg border border-red-200 bg-red-50 p-4">
            <summary className="cursor-pointer text-sm font-medium text-red-900">
              Detalles técnicos
            </summary>
            <pre className="mt-3 overflow-auto rounded bg-red-100 p-3 text-xs text-red-800 font-mono">
              {error.stack || error.message}
            </pre>
          </details>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
