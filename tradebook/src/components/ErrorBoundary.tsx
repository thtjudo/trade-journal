import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error);
    console.error("Component stack:", info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV;
      return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-surface-0 text-primary gap-4 p-6">
          <h1 className="text-base font-medium">Something went wrong</h1>
          {isDev && this.state.error && (
            <pre className="max-w-2xl text-[12px] text-loss bg-white/[0.03] border border-white/[0.06] rounded-md p-3 overflow-auto whitespace-pre-wrap">
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-brand rounded-md hover:bg-brand/90 text-surface-0 text-[13px] font-medium transition-colors"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
