import { Component, type ReactNode, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AppShell } from "@/components/app-shell";

// Pages
import HomePage from "@/pages/home";
import CodeWindowPage from "@/pages/code-window";
import BrowserAgentPage from "@/pages/browser-agent";
import ProvidersPage from "@/pages/providers";
import LogsPage from "@/pages/logs";
import ProviderOnboarding from "@/pages/provider-onboarding";
import NotFound from "@/pages/not-found";

// ─── Error boundary ───────────────────────────────────────────────────────────

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
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Onboarding gate ──────────────────────────────────────────────────────────

function isConfigured(settings: any): boolean {
  if (!settings) return false;
  return !!(settings.model && settings.model.trim().length > 0);
}

function AppGate() {
  const [forceConfigured, setForceConfigured] = useState(false);

  const settingsQuery = useQuery<any>({
    queryKey: ["/api/settings"],
    staleTime: 30_000,
  });

  // Loading spinner
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
      <ProviderOnboarding onComplete={() => setForceConfigured(true)} />
    );
  }

  return (
    <Router hook={useHashLocation}>
      <AppRouter />
    </Router>
  );
}

// ─── Router inside shell ──────────────────────────────────────────────────────

function AppRouter() {
  return (
    <AppShell>
      <Switch>
        {/* Primary entry — home/dashboard */}
        <Route path="/" component={HomePage} />

        {/* Code Studio — main coding workflow */}
        <Route path="/code" component={CodeWindowPage} />

        {/* Browser Agent — autonomous browser tasks */}
        <Route path="/browser-agent" component={BrowserAgentPage} />

        {/* Providers — model & runtime config */}
        <Route path="/providers" component={ProvidersPage} />

        {/* Logs & Tasks — history */}
        <Route path="/logs" component={LogsPage} />

        {/* 404 */}
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

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
