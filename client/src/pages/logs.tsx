/**
 * Logs & Tasks — task history and execution log viewer.
 *
 * Layout:
 *   Left: task list with status filters
 *   Right: selected task detail + step-by-step log
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity, CheckCircle2, XCircle, Clock, Loader2, ShieldAlert,
  X, Globe, RefreshCw, CalendarClock, Info,
} from "lucide-react";
import type { AgentTask, AgentLog } from "@shared/schema";

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; icon: any; cls: string }> = {
  queued:          { label: "Queued",    icon: Clock,       cls: "text-muted-foreground" },
  running:         { label: "Running",   icon: Loader2,     cls: "text-primary border-primary/30" },
  waiting_confirm: { label: "Waiting",   icon: ShieldAlert, cls: "text-amber-400 border-amber-500/30" },
  completed:       { label: "Done",      icon: CheckCircle2,cls: "text-green-400 border-green-500/30" },
  error:           { label: "Error",     icon: XCircle,     cls: "text-red-400 border-red-500/30" },
  cancelled:       { label: "Cancelled", icon: X,           cls: "text-muted-foreground" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] || STATUS_MAP.queued;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${cfg.cls}`}>
      <Icon className={`h-2.5 w-2.5 ${status === "running" ? "animate-spin" : ""}`} />
      {cfg.label}
    </Badge>
  );
}

function statusFilterBg(status: string, active: boolean): string {
  if (!active) return "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50";
  const map: Record<string, string> = {
    all:       "bg-primary/10 text-primary",
    completed: "bg-green-500/10 text-green-400",
    error:     "bg-red-500/10 text-red-400",
    running:   "bg-primary/10 text-primary",
    queued:    "bg-muted text-foreground",
  };
  return map[status] || "bg-primary/10 text-primary";
}

// ─── Task detail ──────────────────────────────────────────────────────────────

function LogEntry({ log }: { log: AgentLog }) {
  const colorMap: Record<string, string> = {
    info: "text-muted-foreground",
    success: "text-green-400",
    warning: "text-amber-400",
    error: "text-red-400",
  };
  const color = colorMap[log.status] || "text-muted-foreground";
  const time = new Date(log.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className={`flex items-start gap-2 py-0.5 log-line`}>
      <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0 w-[62px]">{time}</span>
      <span className={`${color} flex-shrink-0 text-[10px]`}>[{log.action}]</span>
      <span className={`${color} flex-1 break-words text-[12px]`}>{log.detail}</span>
    </div>
  );
}

function TaskDetail({ task }: { task: AgentTask }) {
  const logsQuery = useQuery<{ task: AgentTask; logs: AgentLog[] }>({
    queryKey: ["/api/tasks", task.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tasks/${task.id}`);
      return res.json();
    },
    staleTime: 5_000,
    refetchInterval: task.status === "running" ? 3_000 : false,
  });

  let plan: any[] = [];
  try { plan = JSON.parse(task.plan); } catch {}

  const createdAt = new Date(task.createdAt).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="flex flex-col h-full">
      {/* Task header */}
      <div className="px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-foreground">{task.title}</span>
              <StatusBadge status={task.status} />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Globe className="h-3 w-3" />
              <a
                href={task.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono hover:text-primary transition-colors truncate max-w-[300px]"
              >
                {task.targetUrl}
              </a>
            </div>
          </div>
          <span className="text-[11px] text-muted-foreground flex-shrink-0">{createdAt}</span>
        </div>

        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{task.goal}</p>
      </div>

      {/* Plan steps (if any) */}
      {plan.length > 0 && (
        <div className="px-4 py-3 border-b border-border flex-shrink-0 bg-muted/20">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Execution plan</div>
          <div className="flex flex-col gap-1">
            {plan.map((step: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground flex-shrink-0 w-4 tabular-nums">{i + 1}.</span>
                <span className="text-foreground">{typeof step === "string" ? step : step.description || step.action || JSON.stringify(step)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logs */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground">Execution log</span>
          {logsQuery.isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <span className="text-[11px] text-muted-foreground">{logsQuery.data?.logs?.length ?? 0} entries</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-0.5">
          {logsQuery.data?.logs && logsQuery.data.logs.length > 0
            ? logsQuery.data.logs.map((log) => <LogEntry key={log.id} log={log} />)
            : (
              <div className="text-center py-8">
                <Info className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No log entries for this task.</p>
              </div>
            )
          }
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "running" | "completed" | "error" | "queued";

export default function LogsPage() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(null);

  const tasksQuery = useQuery<AgentTask[]>({
    queryKey: ["/api/tasks"],
    staleTime: 5_000,
    refetchInterval: 8_000,
  });

  const tasks = tasksQuery.data ?? [];
  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);

  // Auto-select first task
  const displayTask = selectedTask ?? filtered[0] ?? null;

  const counts: Record<StatusFilter, number> = {
    all:       tasks.length,
    running:   tasks.filter((t) => t.status === "running" || t.status === "queued").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    error:     tasks.filter((t) => t.status === "error").length,
    queued:    tasks.filter((t) => t.status === "queued").length,
  };

  const FILTERS: { key: StatusFilter; label: string }[] = [
    { key: "all",       label: "All" },
    { key: "running",   label: "Running" },
    { key: "completed", label: "Completed" },
    { key: "error",     label: "Errors" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card/50 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Logs & Tasks</span>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">{tasks.length} total</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => tasksQuery.refetch()}
          data-testid="button-refresh-tasks"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${tasksQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: task list */}
        <div className="w-64 flex-shrink-0 border-r border-border flex flex-col overflow-hidden">
          {/* Filters */}
          <div className="flex gap-1 p-2 border-b border-border flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${statusFilterBg(f.key, filter === f.key)}`}
                data-testid={`filter-${f.key}`}
              >
                {f.label}
                {counts[f.key] > 0 && (
                  <span className="text-[10px] opacity-70">{counts[f.key]}</span>
                )}
              </button>
            ))}
          </div>

          {/* Task list */}
          <ScrollArea className="flex-1">
            {tasksQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <Activity className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No tasks found.</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filtered.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                      displayTask?.id === task.id
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted/60 border border-transparent"
                    }`}
                    data-testid={`task-list-item-${task.id}`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-xs font-medium text-foreground truncate">{task.title}</span>
                      <StatusBadge status={task.status} />
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{task.targetUrl}</div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
                      <CalendarClock className="h-2.5 w-2.5" />
                      {new Date(task.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right: task detail */}
        <div className="flex-1 min-w-0">
          {displayTask ? (
            <TaskDetail task={displayTask} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Activity className="h-12 w-12 text-muted-foreground/20" />
              <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground">No task selected</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Select a task from the list to view its log.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
