/**
 * Home — main dashboard / entry screen for Local Comet.
 *
 * What the user sees first:
 *   - Greeting with model/status indicator
 *   - Quick-start cards for the 4 main sections
 *   - Recent task activity
 *   - Local-first provider guidance if not configured
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Code2,
  Globe,
  Cpu,
  Activity,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Server,
  Cloud,
  Zap,
  Clock,
  Play,
  ArrowRight,
} from "lucide-react";
import { isHostedPreview } from "@/lib/hosting-env";
import type { AgentTask } from "@shared/schema";

// ─── Section cards ────────────────────────────────────────────────────────────

interface SectionCard {
  path: string;
  icon: any;
  label: string;
  tagline: string;
  cta: string;
  accent: string;
}

const SECTIONS: SectionCard[] = [
  {
    path: "/code",
    icon: Code2,
    label: "Code Studio",
    tagline: "Generate, edit and run code — Python, TypeScript, Bash and more. Full editor with live output.",
    cta: "Open Code Studio",
    accent: "blue",
  },
  {
    path: "/browser-agent",
    icon: Globe,
    label: "Browser Agent",
    tagline: "Delegate autonomous web tasks: scrape, fill forms, navigate, extract data — all with AI guidance.",
    cta: "Open Browser Agent",
    accent: "teal",
  },
  {
    path: "/providers",
    icon: Cpu,
    label: "Providers",
    tagline: "Configure Ollama, LM Studio or cloud APIs. Local-first — your models run on your machine.",
    cta: "Manage Providers",
    accent: "violet",
  },
  {
    path: "/logs",
    icon: Activity,
    label: "Logs & Tasks",
    tagline: "Browse task history, inspect step-by-step execution logs and review past results.",
    cta: "View Logs",
    accent: "orange",
  },
];

const ACCENT_CLASSES: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
  blue:   { bg: "bg-blue-500/8",   text: "text-blue-600 dark:text-blue-400",   border: "border-blue-500/15",   iconBg: "bg-blue-500/10"   },
  teal:   { bg: "bg-primary/8",    text: "text-primary",                        border: "border-primary/15",    iconBg: "bg-primary/10"    },
  violet: { bg: "bg-violet-500/8", text: "text-violet-600 dark:text-violet-400",border: "border-violet-500/15", iconBg: "bg-violet-500/10" },
  orange: { bg: "bg-orange-500/8", text: "text-orange-600 dark:text-orange-400",border: "border-orange-500/15", iconBg: "bg-orange-500/10" },
};

function SectionCardUI({ section }: { section: SectionCard }) {
  const Icon = section.icon;
  const a = ACCENT_CLASSES[section.accent];

  return (
    <Link href={section.path}>
      <div
        className={`group relative flex flex-col gap-3 p-4 rounded-xl border ${a.border} ${a.bg} hover:brightness-105 transition-all cursor-pointer`}
        data-testid={`home-section-${section.label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${a.iconBg}`}>
          <Icon className={`h-5 w-5 ${a.text}`} />
        </div>
        <div>
          <div className="font-semibold text-foreground text-sm mb-1">{section.label}</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{section.tagline}</p>
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium mt-auto ${a.text}`}>
          {section.cta}
          <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </Link>
  );
}

// ─── Provider status summary ──────────────────────────────────────────────────

function ProviderBanner() {
  const statusQuery = useQuery<any>({
    queryKey: ["/api/computer/status"],
    refetchInterval: 20_000,
    staleTime: 15_000,
  });

  const hosted = isHostedPreview();
  const s = statusQuery.data;
  // /api/computer/status returns { provider: { type, model, configured, availability } }
  const provider = s?.provider;

  if (statusQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted/50">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Checking provider…</span>
      </div>
    );
  }

  const configured = provider?.configured && provider?.model && provider.model.trim().length > 0;

  if (!configured) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-yellow-500/25 bg-yellow-500/5">
        <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">No provider configured</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Set up Ollama, LM Studio or a cloud API to start generating code and running browser tasks.
          </div>
        </div>
        <Link href="/providers">
          <Button size="sm" variant="outline" className="flex-shrink-0 text-xs h-7">
            Configure <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>
    );
  }

  // availability: { ok, status, message } | null
  const providerOk = provider?.availability?.ok;
  const isLocal = ["ollama", "lmstudio"].includes(provider?.type ?? "");
  const ProviderIcon = isLocal ? Server : Cloud;

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border ${
      providerOk
        ? "border-green-500/20 bg-green-500/5"
        : providerOk === false
        ? "border-destructive/20 bg-destructive/5"
        : "border-border bg-muted/30"
    }`}>
      <ProviderIcon className={`h-4 w-4 flex-shrink-0 ${providerOk ? "text-green-500" : providerOk === false ? "text-destructive" : "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground capitalize">{provider?.type}</span>
        <span className="text-xs text-muted-foreground font-mono truncate">{provider?.model}</span>
        {hosted && isLocal && (
          <Badge variant="outline" className="text-[10px] text-yellow-600 border-yellow-500/30">preview-only</Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {providerOk === true && <Badge variant="outline" className="text-[10px] text-green-600 dark:text-green-400 border-green-500/30">connected</Badge>}
        {providerOk === false && <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">error</Badge>}
        <Link href="/providers">
          <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground hover:text-foreground px-2">
            Settings
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Recent tasks ─────────────────────────────────────────────────────────────

function RecentTasks() {
  const tasksQuery = useQuery<AgentTask[]>({
    queryKey: ["/api/tasks"],
    staleTime: 10_000,
  });

  if (tasksQuery.isLoading || !tasksQuery.data || tasksQuery.data.length === 0) return null;

  const recent = tasksQuery.data.slice(0, 4);

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    if (status === "error" || status === "cancelled") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    if (status === "running" || status === "queued") return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
    return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Recent Tasks</h3>
        <Link href="/logs">
          <span className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">View all</span>
        </Link>
      </div>
      <div className="flex flex-col gap-1.5">
        {recent.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors"
            data-testid={`recent-task-${task.id}`}
          >
            {statusIcon(task.status)}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground truncate">{task.title}</div>
              <div className="text-[11px] text-muted-foreground truncate">{task.targetUrl}</div>
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] flex-shrink-0 ${
                task.status === "completed" ? "text-green-600 dark:text-green-400 border-green-500/30" :
                task.status === "error" ? "text-destructive border-destructive/30" :
                task.status === "running" ? "text-primary border-primary/30" :
                "text-muted-foreground"
              }`}
            >
              {task.status}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Local-first tip banner ───────────────────────────────────────────────────

function LocalFirstTip() {
  const hosted = isHostedPreview();

  if (hosted) return null; // Not relevant in preview

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-primary/15 bg-primary/5">
      <Zap className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
      <div>
        <div className="text-xs font-medium text-foreground">Running locally — Ollama & LM Studio available</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Your models run on your machine — no data leaves your network.
          Start Ollama with <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">ollama serve</code> then select a model in Providers.
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="max-w-3xl w-full mx-auto px-6 py-8 flex flex-col gap-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">Local Comet</h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered code execution and browser automation — local-first, private by default.
          </p>
        </div>

        {/* Provider status */}
        <ProviderBanner />

        {/* Local-first tip */}
        <LocalFirstTip />

        {/* Section cards grid */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Get started</h2>
          <div className="grid grid-cols-2 gap-3">
            {SECTIONS.map((s) => (
              <SectionCardUI key={s.path} section={s} />
            ))}
          </div>
        </div>

        {/* Recent tasks */}
        <RecentTasks />

      </div>
    </div>
  );
}
