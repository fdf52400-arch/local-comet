import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Square, Settings, History, Zap, Globe, Bot,
  CheckCircle2, XCircle, AlertTriangle, Clock, Loader2,
  ChevronRight, Rocket, Shield, ShieldAlert, ShieldCheck,
  Sun, Moon, Link2, FileText,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Link } from "wouter";
import type { AgentTask, DemoScenario, AgentLog } from "@shared/schema";

interface RunResult {
  task: AgentTask;
  plan: any[];
  results: any[];
  planSource: string;
  logs: AgentLog[];
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  pending: { label: "Ожидание", icon: Clock, color: "text-muted-foreground" },
  planning: { label: "Планирование", icon: Loader2, color: "text-yellow-500" },
  running: { label: "Выполнение", icon: Loader2, color: "text-primary" },
  completed: { label: "Завершено", icon: CheckCircle2, color: "text-green-500" },
  error: { label: "Ошибка", icon: XCircle, color: "text-red-500" },
  success: { label: "Успех", icon: CheckCircle2, color: "text-green-500" },
  warning: { label: "Внимание", icon: AlertTriangle, color: "text-yellow-500" },
  blocked: { label: "Заблокировано", icon: Shield, color: "text-orange-400" },
  info: { label: "Инфо", icon: Clock, color: "text-muted-foreground" },
};

const SAFETY_MODES: Record<string, { label: string; icon: any; desc: string }> = {
  readonly: { label: "Только чтение", icon: ShieldCheck, desc: "Агент только читает страницы" },
  confirm: { label: "С подтверждением", icon: ShieldAlert, desc: "Спрашивает перед действием" },
  full: { label: "Полный доступ", icon: Shield, desc: "Все действия разрешены" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const isSpinning = status === "planning" || status === "running";
  return (
    <Badge variant="outline" className={`${config.color} gap-1`}>
      <Icon className={`h-3 w-3 ${isSpinning ? "animate-spin" : ""}`} />
      {config.label}
    </Badge>
  );
}

function LogEntry({ log }: { log: any }) {
  const statusColors: Record<string, string> = {
    success: "text-green-400",
    error: "text-red-400",
    warning: "text-yellow-400",
    info: "text-muted-foreground",
  };
  return (
    <div className="log-line flex gap-2 py-1 border-b border-border/50">
      <span className="text-muted-foreground/60 shrink-0 w-5 text-right">{log.stepIndex || "—"}</span>
      <span className={`shrink-0 ${statusColors[log.status] || "text-muted-foreground"}`}>
        {log.status === "success" ? "✓" : log.status === "error" ? "✗" : log.status === "warning" ? "⚠" : "·"}
      </span>
      <span className="text-muted-foreground/70 shrink-0">[{log.action}]</span>
      <span className="break-all">{log.detail}</span>
    </div>
  );
}

export default function ControlCenter() {
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [targetUrl, setTargetUrl] = useState("");
  const [goalText, setGoalText] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  // Queries
  const settingsQuery = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  const tasksQuery = useQuery<AgentTask[]>({
    queryKey: ["/api/tasks"],
  });

  const scenariosQuery = useQuery<DemoScenario[]>({
    queryKey: ["/api/agent/demo-scenarios"],
  });

  const healthQuery = useQuery<any>({
    queryKey: ["/api/health"],
  });

  // Provider check
  const checkMutation = useMutation({
    mutationFn: async () => {
      const s = settingsQuery.data;
      const res = await apiRequest("POST", "/api/providers/check", {
        providerType: s?.providerType || "ollama",
        baseUrl: s?.baseUrl || "http://localhost",
        port: s?.port || 11434,
      });
      return res.json();
    },
  });

  // Run agent
  const runMutation = useMutation({
    mutationFn: async (data: { url: string; goal: string }) => {
      const res = await apiRequest("POST", "/api/agent/run", data);
      return res.json();
    },
    onSuccess: (data: RunResult) => {
      setRunResult(data);
      setActiveTaskId(data.task?.id || null);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: "Задача выполнена",
        description: data.planSource === "model" ? "План от модели" : "Эвристический план",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Ошибка выполнения",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleRun = () => {
    if (!targetUrl || !goalText) {
      toast({ title: "Заполните URL и задачу", variant: "destructive" });
      return;
    }
    setRunResult(null);
    runMutation.mutate({ url: targetUrl, goal: goalText });
  };

  const handleDemoSelect = (scenario: DemoScenario) => {
    setTargetUrl(scenario.targetUrl);
    setGoalText(scenario.goal);
  };

  const settings = settingsQuery.data;
  const safetyMode = settings?.safetyMode || "readonly";
  const safetyConfig = SAFETY_MODES[safetyMode] || SAFETY_MODES.readonly;
  const SafetyIcon = safetyConfig.icon;

  return (
    <div className="h-screen flex flex-col bg-background" data-testid="control-center">
      {/* Top bar */}
      <header className="h-12 border-b border-border flex items-center px-4 gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-label="Local Comet" className="text-primary">
            <circle cx="16" cy="16" r="6" stroke="currentColor" strokeWidth="2" />
            <path d="M16 4 L18 10 L16 8 L14 10 Z" fill="currentColor" opacity="0.7" />
            <path d="M4 16 L10 14 L8 16 L10 18 Z" fill="currentColor" opacity="0.5" />
            <path d="M28 16 L22 18 L24 16 L22 14 Z" fill="currentColor" opacity="0.5" />
            <path d="M16 28 L14 22 L16 24 L18 22 Z" fill="currentColor" opacity="0.7" />
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.3" />
          </svg>
          <span className="font-semibold text-sm tracking-tight">Local Comet</span>
        </div>

        <Separator orientation="vertical" className="h-5" />

        <div className="flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full ${healthQuery.data?.status === "ok" ? "bg-green-500 status-pulse" : "bg-red-500"}`} />
          <span className="text-muted-foreground">Сервер</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full ${checkMutation.data?.ok ? "bg-green-500" : "bg-muted-foreground"}`} />
          <span className="text-muted-foreground">
            {settings?.providerType === "lmstudio" ? "LM Studio" : "Ollama"}
          </span>
          {settings?.model && (
            <span className="text-foreground/80">{settings.model}</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="gap-1 text-xs">
            <SafetyIcon className="h-3 w-3" />
            {safetyConfig.label}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={toggleTheme}
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>

      {/* Main 3-column layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left sidebar: tasks + history + demos */}
        <aside className="w-64 border-r border-border flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              <Rocket className="h-3.5 w-3.5" />
              Демо-сценарии
            </div>
            {scenariosQuery.data?.map(scenario => (
              <button
                key={scenario.id}
                onClick={() => handleDemoSelect(scenario)}
                className="w-full text-left p-2 rounded-md hover:bg-accent/50 transition-colors mb-1 group"
                data-testid={`button-demo-${scenario.id}`}
              >
                <div className="text-xs font-medium group-hover:text-primary transition-colors">{scenario.title}</div>
                <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{scenario.description}</div>
              </button>
            ))}
          </div>

          <div className="p-3 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              <History className="h-3.5 w-3.5" />
              История задач
            </div>
            <ScrollArea className="flex-1">
              {tasksQuery.data?.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Нет выполненных задач</p>
              )}
              {tasksQuery.data?.map(task => (
                <button
                  key={task.id}
                  onClick={() => setActiveTaskId(task.id)}
                  className={`w-full text-left p-2 rounded-md transition-colors mb-1 ${
                    activeTaskId === task.id ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                  data-testid={`button-task-${task.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium truncate flex-1">{task.title}</span>
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">{task.targetUrl}</div>
                </button>
              ))}
            </ScrollArea>
          </div>
        </aside>

        {/* Center: task input + execution journal */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Task input area */}
          <div className="p-4 border-b border-border">
            <div className="flex gap-3 mb-3">
              <div className="flex-1 flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  placeholder="URL страницы (например, https://example.com)"
                  value={targetUrl}
                  onChange={e => setTargetUrl(e.target.value)}
                  className="h-9 text-sm"
                  data-testid="input-target-url"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 flex items-start gap-2">
                <Bot className="h-4 w-4 text-muted-foreground shrink-0 mt-2.5" />
                <Textarea
                  placeholder="Опишите задачу для агента (например, «Суммаризировать содержимое страницы»)"
                  value={goalText}
                  onChange={e => setGoalText(e.target.value)}
                  className="min-h-[60px] text-sm resize-none"
                  rows={2}
                  data-testid="input-goal-text"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleRun}
                  disabled={runMutation.isPending || !targetUrl || !goalText}
                  className="h-9 gap-2"
                  data-testid="button-run-agent"
                >
                  {runMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Запустить
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={() => checkMutation.mutate()}
                  disabled={checkMutation.isPending}
                  data-testid="button-check-provider"
                >
                  <Zap className="h-3 w-3" />
                  Проверить
                </Button>
              </div>
            </div>
            {checkMutation.data && (
              <div className={`mt-2 text-xs flex items-center gap-1 ${checkMutation.data.ok ? "text-green-500" : "text-red-400"}`}>
                {checkMutation.data.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {checkMutation.data.message}
              </div>
            )}
          </div>

          {/* Execution journal */}
          <ScrollArea className="flex-1 p-4">
            {runMutation.isPending && (
              <div className="flex items-center gap-3 justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Агент выполняет задачу...</span>
              </div>
            )}

            {!runMutation.isPending && !runResult && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Bot className="h-12 w-12 mb-4 opacity-30" />
                <p className="text-sm font-medium mb-1">Центр управления Local Comet</p>
                <p className="text-xs">Укажите URL и задачу, или выберите демо-сценарий</p>
              </div>
            )}

            {runResult && (
              <div className="space-y-4">
                {/* Plan */}
                <Card className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold">План выполнения</span>
                    <Badge variant="outline" className="text-xs ml-auto">
                      {runResult.planSource === "model" ? "от модели" : "эвристический"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {runResult.plan.map((step: any, i: number) => {
                      const result = runResult.results[i];
                      const statusColor = result
                        ? result.status === "success" ? "text-green-400"
                        : result.status === "error" ? "text-red-400"
                        : result.status === "warning" ? "text-yellow-400"
                        : "text-muted-foreground"
                        : "text-muted-foreground";
                      return (
                        <div key={i} className="flex items-start gap-2 py-1 text-xs">
                          <span className={`shrink-0 mt-0.5 ${statusColor}`}>
                            {result?.status === "success" ? "✓" : result?.status === "error" ? "✗" : result?.status === "warning" ? "⚠" : "○"}
                          </span>
                          <span className="font-mono text-muted-foreground">{step.action}</span>
                          {step.params && (
                            <span className="text-muted-foreground/60 truncate">
                              {Object.entries(step.params).map(([k, v]) => `${k}=${v}`).join(", ")}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Results detail */}
                {runResult.results.map((result: any, i: number) => (
                  <Card key={i} className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-primary">{result.action}</span>
                      <StatusBadge status={result.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{result.detail}</p>
                    {result.data && (
                      <details className="mt-2">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                          Данные
                        </summary>
                        <pre className="mt-1 text-xs font-mono bg-muted/30 p-2 rounded overflow-x-auto max-h-48">
                          {JSON.stringify(result.data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </Card>
                ))}

                {/* Execution log */}
                <Card className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Журнал выполнения</span>
                  </div>
                  {runResult.logs.map((log: any, i: number) => (
                    <LogEntry key={i} log={log} />
                  ))}
                </Card>
              </div>
            )}
          </ScrollArea>
        </main>

        {/* Right sidebar: settings */}
        <aside className="w-72 border-l border-border flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Settings className="h-3.5 w-3.5" />
              Настройки
            </div>
          </div>
          <ScrollArea className="flex-1 p-3">
            <div className="space-y-4">
              {/* Provider info */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Провайдер</label>
                <div className="text-sm font-medium">
                  {settings?.providerType === "lmstudio" ? "LM Studio" : "Ollama"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {settings?.baseUrl || "http://localhost"}:{settings?.port || 11434}
                </div>
              </div>

              <Separator />

              {/* Model */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Модель</label>
                <div className="text-sm">
                  {settings?.model || <span className="text-muted-foreground italic">не выбрана</span>}
                </div>
              </div>

              {/* Temperature */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Temperature</label>
                <div className="text-sm font-mono">{settings?.temperature || "0.7"}</div>
              </div>

              {/* Max tokens */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Max tokens</label>
                <div className="text-sm font-mono">{settings?.maxTokens || 2048}</div>
              </div>

              <Separator />

              {/* Safety mode */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Режим безопасности</label>
                <div className="flex items-center gap-2">
                  <SafetyIcon className="h-4 w-4 text-primary" />
                  <div>
                    <div className="text-sm font-medium">{safetyConfig.label}</div>
                    <div className="text-[11px] text-muted-foreground">{safetyConfig.desc}</div>
                  </div>
                </div>
              </div>

              <Separator />

              <Link href="/settings">
                <Button variant="outline" size="sm" className="w-full gap-2 text-xs" data-testid="button-open-settings">
                  <Settings className="h-3.5 w-3.5" />
                  Все настройки
                </Button>
              </Link>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
