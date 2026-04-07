/**
 * AppShell — global layout wrapper with sidebar navigation.
 *
 * Structure:
 *   ┌─────────┬──────────────────────────────────┐
 *   │ Sidebar │  Main content area               │
 *   │  Logo   │                                  │
 *   │  Nav    │                                  │
 *   │  Status │                                  │
 *   └─────────┴──────────────────────────────────┘
 */

import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/lib/theme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Home,
  Code2,
  Globe,
  Settings,
  Activity,
  Sun,
  Moon,
  Cpu,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Server,
  Cloud,
} from "lucide-react";
import { isHostedPreview } from "@/lib/hosting-env";

// ─── Nav items ───────────────────────────────────────────────────────────────

interface NavItem {
  path: string;
  label: string;
  icon: any;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/",              label: "Home",          icon: Home,     description: "Dashboard & quick start" },
  { path: "/code",         label: "Code Studio",   icon: Code2,    description: "Generate, edit & run code" },
  { path: "/browser-agent",label: "Browser Agent", icon: Globe,    description: "Autonomous browser tasks" },
  { path: "/providers",    label: "Providers",     icon: Cpu,      description: "Model & runtime settings" },
  { path: "/logs",         label: "Logs & Tasks",  icon: Activity, description: "Task history & current state" },
];

// ─── Provider status chip ────────────────────────────────────────────────────

function ProviderStatus() {
  const statusQuery = useQuery<any>({
    queryKey: ["/api/computer/status"],
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const s = statusQuery.data;
  const provider = s?.settings?.providerType;
  const model = s?.settings?.model;
  const providerOk = s?.providerStatus?.ok;
  const isLocal = provider ? ["ollama", "lmstudio"].includes(provider) : false;
  const isConfigured = !!(provider && model);

  if (!isConfigured) {
    return (
      <Link href="/providers">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
          <AlertTriangle className="h-3 w-3 text-amber-400" />
          <span className="text-xs text-muted-foreground">No provider</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto" />
        </div>
      </Link>
    );
  }

  return (
    <Link href="/providers">
      <div className={`flex flex-col gap-0.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        providerOk === true  ? "bg-green-500/10 hover:bg-green-500/15" :
        providerOk === false ? "bg-destructive/10 hover:bg-destructive/15" :
        "bg-muted/50 hover:bg-muted"
      }`}>
        <div className="flex items-center gap-1.5">
          {isLocal ? <Server className="h-3 w-3 text-muted-foreground" /> : <Cloud className="h-3 w-3 text-muted-foreground" />}
          <span className="text-xs font-medium text-foreground capitalize">{provider}</span>
          {providerOk === true  && <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto" />}
          {providerOk === false && <XCircle className="h-3 w-3 text-destructive ml-auto" />}
        </div>
        <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[140px]">{model}</span>
      </div>
    </Link>
  );
}

// ─── Sidebar NavItem ─────────────────────────────────────────────────────────

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={item.path}>
      <div
        className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-all cursor-pointer select-none ${
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
        }`}
        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <Icon className={`h-4 w-4 flex-shrink-0 ${active ? "text-primary" : ""}`} />
        <span>{item.label}</span>
        {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
      </div>
    </Link>
  );
}

// ─── Logo SVG ────────────────────────────────────────────────────────────────

function CometLogo({ size = 24 }: { size?: number }) {
  return (
    <svg
      aria-label="Local Comet"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Comet body: bright nucleus */}
      <circle cx="16" cy="8" r="4" fill="currentColor" opacity="0.95" />
      {/* Tail streaks */}
      <line x1="12.5" y1="11.5" x2="4" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <line x1="11.5" y1="10.5" x2="3" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
      <line x1="13" y1="12" x2="6" y2="22" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
    </svg>
  );
}

// ─── Main AppShell ────────────────────────────────────────────────────────────

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const hosted = isHostedPreview();

  // Normalize path — root "/" or hash segments
  const currentPath = location === "" ? "/" : location;

  return (
    <div className="flex h-screen overflow-hidden bg-background" data-testid="app-shell">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-52 flex-shrink-0 flex flex-col border-r border-border bg-sidebar overflow-y-auto">
        {/* Logo header */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
          <div className="text-primary">
            <CometLogo size={22} />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground leading-tight">Local Comet</span>
            <span className="text-[10px] text-muted-foreground leading-tight">
              {hosted ? "preview" : "local"}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = item.path === "/"
              ? currentPath === "/"
              : currentPath.startsWith(item.path);
            return <NavLink key={item.path} item={item} active={isActive} />;
          })}
        </nav>

        {/* Provider status + theme toggle */}
        <div className="px-2 py-3 border-t border-border flex flex-col gap-2">
          <ProviderStatus />
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-muted-foreground">Theme</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={toggleTheme}
              data-testid="theme-toggle"
            >
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col" data-testid="main-content">
        {children}
      </main>
    </div>
  );
}

export default AppShell;
