import { Component, type ReactNode } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import ControlCenter from "@/pages/control-center";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";
import KworkLeadsPage from "@/pages/kwork-leads";

// Error boundary to prevent blank screen
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", color: "#ef4444", fontFamily: "monospace", background: "#111", minHeight: "100vh" }}>
          <h2 style={{ marginBottom: "1rem" }}>Local Comet: UI Error</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ marginTop: "1rem", padding: "0.5rem 1rem", background: "#333", color: "#fff", border: "1px solid #555", borderRadius: "4px", cursor: "pointer" }}
          >
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={ControlCenter} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/kwork" component={KworkLeadsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
