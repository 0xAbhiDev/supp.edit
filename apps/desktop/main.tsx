import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { lifecycleMark } from "../../packages/platform";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    lifecycleMark("page render error", e.message);
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>supp.edit encountered an error</h1>
        <p>{this.state.error}</p>
        <p>Your latest recovery snapshot is available after reloading.</p>
        <button onClick={() => location.reload()}>Reload editor</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
lifecycleMark("page loaded");
addEventListener("error", (e) => lifecycleMark("page error", `${e.message} at ${e.filename}:${e.lineno}`));
addEventListener("unhandledrejection", (e) =>
  lifecycleMark("page unhandled rejection", e.reason instanceof Error ? e.reason.message : String(e.reason)),
);
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
