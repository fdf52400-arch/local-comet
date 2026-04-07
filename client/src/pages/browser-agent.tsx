/**
 * Browser Agent — clean, dedicated UX for autonomous browser tasks.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────┐
 *   │  Header: title + status + safety mode           │
 *   ├──────────────────────┬──────────────────────────┤
 *   │  Left: task input    │  Right: live log / result│
 *   │  + active task state │  + screenshot preview    │
 *   └──────────────────────┴──────────────────────────┘
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Globe, CheckCircle2, XCircle, AlertTriangle, Clock, Loader2,
  Shield, ShieldAlert, ShieldCheck,
  RefreshCw, Send, X, RotateCcw, Info,
  AlertOctagon, Scan, Brain, Cpu,
  ChevronRight, Square, Activity,
} from "lucide-react";
import type { AgentTask } from "@shared/schema";
import { isHostedPreview } from "@/lib/hosting-env";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentEvent {
  type: string;
  taskId: number;
  step?: number;
  maxSteps?: number;
  phase?: string;
  detail: string;
  data?: any;
  timestamp: string;
}

interface ConfirmRequest {
  taskId: number;
  sessionId: string;
  step: number;
  action: string;
  params?: Record<string, string>;
  detail: string;
  riskLevel: "low" | "medium" | "high";
  riskReason: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  planning: "text-violet-400",
  observation: "text-cyan-400",
  reasoning: "text-violet-400",
  action: "text-amber-400",
  action_result: "text-green-400",
  confirm_request: "text-orange-400",
  warning: "text-yellow-400",
  error: "text-red-400",
  blocked: "text-orange-400",
  completed: "text-green-400",
  step_counter: "text-muted-foreground",
  preview_update: "text-primary",
};

const EVENT_ICONS: Record<string, string> = {
  planning: "◈", observation: "◉", reasoning: "◆", action: "▶",
  action_result: "✓", confirm_request: "⚡", warning: "⚠",
  error: "✗", blocked: "⊘", completed: "★",
  step_counter: "·", preview_update: "◎",
};

const RISK_COLORS: Record<string, string> = {
  low: "text-green-400 border-green-500/30 bg-green-500/8",
  medium: "text-amber-400 border-amber-500/30 bg-amber-500/8",
  high: "text-red-400 border-red-500/30 bg-red-500/8",
};

const SAFETY_MODES = {
  readonly: { label: "Read-only", icon: ShieldCheck, desc: "Agent only reads pages, no actions", color: "text-green-500" },
  confirm: { label: "Confirm", icon: ShieldAlert, desc: "Ask before each action", color: "text-amber-400" },
  full: { label: "Full access", icon: Shield, desc: "All actions permitted automatically", color: "text-red-400" },
};

const DEMO_TASKS = [
  { url: "https://ru.wikipedia.org/wiki/Искусственный_интеллект", goal: "Summarise the page content into key sections" },
  { url: "https://news.ycombinator.com", goal: "List the top 5 headlines with links" },
  { url: "https://httpbin.org", goal: "Explore the page structure and list available endpoints" },
];

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ req, onConfirm, onDeny, pending }: {
  req: ConfirmRequest;
  onConfirm: () => void;
  onDeny: () => void;
  pending: boolean;
}) {
  const RiskIcon = req.riskLevel === "high" ? AlertOctagon : req.riskLevel === "medium" ? AlertTriangle : CheckCircle2;
  const cls = RISK_COLORS[req.riskLevel] || RISK_COLORS.low;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className={`w-[420px] rounded-xl border-2 ${cls} bg-card shadow-2xl overflow-hidden`} data-testid="confirm-dialog">
        <div className={`px-4 py-3 ${cls} flex items-center gap-3`}>
          <RiskIcon className="h-5 w-5" />
          <div>
            <div className="text-sm font-semibold text-foreground">Action confirmation required</div>
            <div className="text-[11px] text-muted-foreground">Risk: {req.riskLevel}</div>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-foreground">{req.detail}</p>
          <div className={`flex items-start gap-2 p-2.5 rounded-lg border ${cls}`}>
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">{req.riskReason}</p>
          </div>
          {req.params && Object.keys(req.params).length > 0 && (
            <div className="bg-muted/30 rounded-lg p-2.5 space-y-1 text-xs font-mono">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Parameters</div>
              {Object.entries(req.params).map(([k, v]) => (
                <div key={k}><span className="text-muted-foreground">{k}: </span>{v}</div>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex gap-2">
          <Button variant="outline" onClick={onDeny} disabled={pending} className="flex-1" data-testid="button-deny">
            <XCircle className="h-4 w-4 mr-1.5" /> Deny
          </Button>
          <Button onClick={onConfirm} disabled={pending} className="flex-1" data-testid="button-confirm">
            {pending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Log line ─────────────────────────────────────────────────────────────────

function LogLine({ event }: { event: AgentEvent }) {
  if (event.type === "step_counter") return null;
  const color = EVENT_COLORS[event.type] || "text-muted-foreground";
  const icon = EVENT_ICONS[event.type] || "·";
  const time = new Date(event.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="flex items-start gap-2 py-0.5 log-line">
      <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0 mt-0.5 w-[62px]">{time}</span>
      <span className={`${color} flex-shrink-0 w-3`}>{icon}</span>
      <span className={`${color} flex-1 break-words`}>{event.detail}</span>
    </div>
  );
}

// ─── Task card (active / recent) ──────────────────────────────────────────────

function TaskStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: any }> = {
    queued:          { label: "Queued",    cls: "text-muted-foreground",               icon: Clock },
    running:         { label: "Running",   cls: "text-primary border-primary/30",       icon: Loader2 },
    waiting_confirm: { label: "Waiting",   cls: "text-amber-400 border-amber-500/30",   icon: ShieldAlert },
    completed:       { label: "Done",      cls: "text-green-400 border-green-500/30",   icon: CheckCircle2 },
    error:           { label: "Error",     cls: "text-red-400 border-red-500/30",       icon: XCircle },
    cancelled:       { label: "Cancelled", cls: "text-muted-foreground",               icon: X },
  };
  const cfg = map[status] || map.queued;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${cfg.cls}`}>
      <Icon className={`h-2.5 w-2.5 ${status === "running" ? "animate-spin" : ""}`} />
      {cfg.label}
    </Badge>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BrowserAgentPage() {
  const { toast } = useToast();
  const hosted = isHostedPreview();
  const logEndRef = useRef<HTMLDivElement>(null);

  // Form state
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [safetyMode, setSafetyMode] = useState<"readonly" | "confirm" | "full">("readonly");

  // Live state
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);

  // ── SSE connection ─────────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const ev: AgentEvent = JSON.parse(e.data);
        setEvents((prev) => [...prev.slice(-200), ev]);
        if (ev.type === "confirm_request" && ev.data) {
          setConfirmReq(ev.data as ConfirmRequest);
        }
        if (ev.type === "preview_update" && ev.data?.screenshotBase64) {
          setScreenshot(ev.data.screenshotBase64);
        }
        if (ev.type === "completed" || ev.type === "error") {
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        }
      } catch {}
    };
    return () => es.close();
  }, []);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // ── Queries ────────────────────────────────────────────────────────────────

  const settingsQuery = useQuery<any>({ queryKey: ["/api/settings"], staleTime: 30_000 });
  const tasksQuery = useQuery<AgentTask[]>({ queryKey: ["/api/tasks"], staleTime: 8_000 });
  const statusQuery = useQuery<any>({ queryKey: ["/api/computer/status"], refetchInterval: 10_000 });

  const activeTask = tasksQuery.data?.find(t => t.id === activeTaskId);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tasks", {
        title: goal.slice(0, 60) || "Browser task",
        targetUrl: url,
        goal,
        safetyMode,
      });
      return res.json();
    },
    onSuccess: (task: AgentTask) => {
      setActiveTaskId(task.id);
      setEvents([]);
      setScreenshot(null);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: (err: any) => toast({ title: "Failed to start task", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (taskId: number) => {
      await apiRequest("POST", `/api/tasks/${taskId}/cancel`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (approve: boolean) => {
      if (!confirmReq) return;
      await apiRequest("POST", `/api/agent/confirm/${confirmReq.taskId}`, { approved: approve });
    },
    onSuccess: () => setConfirmReq(null),
  });

  const safetyMutation = useMutation({
    mutationFn: async (mode: string) => {
      await apiRequest("PATCH", "/api/settings", { safetyMode: mode });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
  });

  // ── Derived state ──────────────────────────────────────────────────────────

  const isRunning = activeTask?.status === "running" || activeTask?.status === "queued" || activeTask?.status === "waiting_confirm";
  const canRun = url.trim().length > 0 && goal.trim().length > 0 && !isRunning;
  const chromiumOk = statusQuery.data?.chromiumAvailable !== false;
  const currentSafety: keyof typeof SAFETY_MODES = (settingsQuery.data?.safetyMode as any) || safetyMode;
  const SafetyIcon = SAFETY_MODES[currentSafety]?.icon || Shield;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleRun = () => {
    if (!canRun) return;
    // Save safety mode to settings
    safetyMutation.mutate(safetyMode);
    runMutation.mutate();
  };

  const handleDemo = (demo: typeof DEMO_TASKS[0]) => {
    setUrl(demo.url);
    setGoal(demo.goal);
  };

  const filteredEvents = activeTaskId
    ? events.filter((e) => e.taskId === activeTaskId || !e.taskId)
    : events;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card/50 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Globe className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Browser Agent</span>
          {!chromiumOk && (
            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 gap-1">
              <AlertTriangle className="h-2.5 w-2.5" /> Chromium not available
            </Badge>
          )}
          {hosted && (
            <Badge variant="outline" className="text-[10px] text-primary border-primary/30 gap-1">
              <Globe className="h-2.5 w-2.5" /> Preview mode
            </Badge>
          )}
        </div>

        {/* Safety mode selector */}
        <div className="flex items-center gap-2">
          <SafetyIcon className={`h-3.5 w-3.5 ${SAFETY_MODES[safetyMode]?.color}`} />
          <Select value={safetyMode} onValueChange={(v) => setSafetyMode(v as any)}>
            <SelectTrigger className="h-7 text-xs w-36 border-border bg-background" data-testid="safety-mode-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SAFETY_MODES).map(([k, v]) => {
                const Icon = v.icon;
                return (
                  <SelectItem key={k} value={k}>
                    <div className="flex items-center gap-2">
                      <Icon className={`h-3.5 w-3.5 ${v.color}`} />
                      <span>{v.label}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: task input + state */}
        <div className="w-72 flex-shrink-0 flex flex-col border-r border-border overflow-y-auto">
          <div className="p-4 flex flex-col gap-4">

            {/* URL input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Target URL</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="text-sm font-mono"
                data-testid="input-url"
              />
            </div>

            {/* Goal input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Goal</label>
              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What should the agent do on this page?"
                className="text-sm resize-none"
                rows={4}
                data-testid="input-goal"
              />
            </div>

            {/* Safety mode description */}
            <div className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-xs ${
              safetyMode === "readonly" ? "border-green-500/20 bg-green-500/5 text-green-600 dark:text-green-400" :
              safetyMode === "confirm"  ? "border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400" :
              "border-red-500/20 bg-red-500/5 text-red-500"
            }`}>
              <SafetyIcon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{SAFETY_MODES[safetyMode]?.desc}</span>
            </div>

            {/* Run / Cancel */}
            {isRunning ? (
              <Button
                variant="outline"
                className="w-full gap-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => activeTaskId && cancelMutation.mutate(activeTaskId)}
                data-testid="button-cancel"
              >
                <Square className="h-4 w-4" /> Stop task
              </Button>
            ) : (
              <Button
                className="w-full gap-2"
                disabled={!canRun || runMutation.isPending}
                onClick={handleRun}
                data-testid="button-run"
              >
                {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run
              </Button>
            )}

          </div>

          {/* Demo tasks */}
          <div className="px-4 pb-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Demo tasks</div>
            <div className="flex flex-col gap-1.5">
              {DEMO_TASKS.map((demo, i) => (
                <button
                  key={i}
                  onClick={() => handleDemo(demo)}
                  className="text-left px-2.5 py-2 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors group"
                  data-testid={`demo-task-${i}`}
                >
                  <div className="text-xs text-muted-foreground font-mono truncate">{demo.url}</div>
                  <div className="text-xs text-foreground mt-0.5 flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-primary group-hover:translate-x-0.5 transition-transform" />
                    {demo.goal}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Recent tasks */}
          {tasksQuery.data && tasksQuery.data.length > 0 && (
            <div className="px-4 pb-4 border-t border-border pt-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent</div>
              <div className="flex flex-col gap-1.5">
                {tasksQuery.data.slice(0, 5).map((task) => (
                  <div
                    key={task.id}
                    onClick={() => setActiveTaskId(task.id)}
                    className={`px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                      activeTaskId === task.id ? "bg-primary/10 border border-primary/20" : "bg-muted/30 hover:bg-muted/60"
                    }`}
                    data-testid={`task-item-${task.id}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs text-foreground truncate">{task.title}</span>
                      <TaskStatusBadge status={task.status} />
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{task.targetUrl}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: log + screenshot */}
        <div className="flex-1 min-w-0 flex flex-col">

          {/* Active task header */}
          {activeTask && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 flex-shrink-0">
              <Activity className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-foreground truncate flex-1">{activeTask.title}</span>
              <TaskStatusBadge status={activeTask.status} />
              <span className="text-[11px] text-muted-foreground font-mono">{activeTask.targetUrl}</span>
            </div>
          )}

          <div className="flex flex-1 min-h-0">
            {/* Live log */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">Live Log</span>
                  {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-primary status-pulse" />}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-muted-foreground px-2"
                  onClick={() => setEvents([])}
                >
                  Clear
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-0.5">
                  {filteredEvents.length === 0 && (
                    <div className="text-center py-12">
                      <Globe className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No events yet.</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Enter a URL and goal, then hit Run.</p>
                    </div>
                  )}
                  {filteredEvents.map((ev, i) => (
                    <LogLine key={i} event={ev} />
                  ))}
                  <div ref={logEndRef} />
                </div>
              </ScrollArea>
            </div>

            {/* Screenshot panel */}
            {screenshot && (
              <div className="w-72 flex-shrink-0 border-l border-border flex flex-col">
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
                  <Scan className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground">Screenshot</span>
                </div>
                <div className="flex-1 overflow-auto p-2">
                  <img
                    src={`data:image/png;base64,${screenshot}`}
                    alt="Browser screenshot"
                    className="w-full rounded border border-border"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm dialog overlay */}
      {confirmReq && (
        <ConfirmDialog
          req={confirmReq}
          onConfirm={() => confirmMutation.mutate(true)}
          onDeny={() => confirmMutation.mutate(false)}
          pending={confirmMutation.isPending}
        />
      )}
    </div>
  );
}
