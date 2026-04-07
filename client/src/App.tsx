import { Component, type ReactNode, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import ControlCenter from "@/pages/control-center";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";
import KworkLeadsPage from "@/pages/kwork-leads";
import ProviderOnboarding from "@/pages/provider-onboarding";
import CodeWindowPage from "@/pages/code-window";

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

// ─── Onboarding gate ─────────────────────────────────────────────────────────
//
// Determines whether we should show the onboarding screen or the main app.
// Logic: show onboarding if settings are not loaded yet (first load) OR if
// the settings have no model configured (empty model field).
// Once the user completes onboarding (saves config), we flip `configured` to
// true and show the main app.

function isConfigured(settings: any): boolean {
  if (!settings) return false;
  // A config is considered "done" when a model name is saved
  return !!(settings.model && settings.model.trim().length > 0);
}

function AppGate() {
  const [forceConfigured, setForceConfigured] = useState(false);

  const settingsQuery = useQuery<any>({
    queryKey: ["/api/settings"],
    // Re-check every 30 seconds in case something changes externally
    staleTime: 30_000,
  });

  // While loading, render nothing (avoids flash)
  if (settingsQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const configured = forceConfigured || isConfigured(settingsQuery.data);

  if (!configured) {
    return (
      <ProviderOnboarding
        onComplete={() => setForceConfigured(true)}
      />
    );
  }

  return (
    <Router hook={useHashLocation}>
      <AppRouter />
    </Router>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={ControlCenter} />
      <Route path="/code" component={CodeWindowPage} />
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
            <AppGate />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
