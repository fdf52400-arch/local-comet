import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Settings, Zap, Globe, Bot,
  CheckCircle2, XCircle, AlertTriangle, Clock, Loader2,
  Shield, ShieldAlert, ShieldCheck,
  Sun, Moon, Eye, Brain, Cpu, 
  ChevronDown, ChevronUp, ChevronRight, ChevronLeft,
  Scan, Monitor, RefreshCw, Send,
  Plus, X, RotateCcw, PlayCircle,
  PauseCircle, StepForward, StepBack,
  AlertOctagon, Info, Download, Search,
  ArrowLeft, ArrowRight, Save, Sparkles,
  MonitorSmartphone,
  Server, PanelRightClose,
  MoreHorizontal, Crosshair, Hash,
  MessageSquare, BookOpen, TrendingUp,
  CircleDot, Briefcase,
  Command as CommandIcon,
  Code2,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Link, useLocation } from "wouter";
import { parseIntent, isCodeIntent, EXAMPLE_COMMANDS, CAPABILITIES, KNOWN_SITES } from "@/lib/intent-parser";
import type { AgentTask, DemoScenario, Workspace, SessionTab } from "@shared/schema";
import { LOCAL_PROVIDERS, CLOUD_PROVIDERS, CONFIG_ONLY_PROVIDERS, type ProviderType } from "@shared/schema";
import {
  isHostedPreview,
  DEFAULT_OLLAMA_PORT, DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_LM_STUDIO_PORT, DEFAULT_LM_STUDIO_BASE_URL,
  EXAMPLE_LM_STUDIO_MODEL,
  MINIMAX_BASE_URL, EXAMPLE_MINIMAX_MODEL,
} from "@/lib/hosting-env";

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface DOMElement {
  tag: string;
  type: string;
  text: string;
  href?: string;
  placeholder?: string;
  name?: string;
  index: number;
}

interface PageSnapshot {
  url: string;
  title: string;
  textSnippet: string;
  elements: DOMElement[];
  stats: {
    links: number;
    buttons: number;
    inputs: number;
    forms: number;
    images: number;
    headings: number;
  };
  headings: string[];
  metaDescription: string;
}

interface PreviewSync {
  url: string;
  syncId: number;
  timestamp: string;
  currentAction: string | null;
  hasScreenshot: boolean;
  snapshot: PageSnapshot | null;
  sessionId?: string;
}

interface StepData {
  id: number;
  taskId: number;
  sessionId: string;
  stepIndex: number;
  phase: string;
  action: string;
  status: string;
  detail: string;
  timestamp: string;
  hasScreenshot: boolean;
  snapshotJson: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  queued: { label: "В очереди", color: "text-muted-foreground", bg: "bg-muted/30", icon: Clock },
  running: { label: "Выполняется", color: "text-blue-400", bg: "bg-blue-500/10", icon: Loader2 },
  waiting_confirm: { label: "Ожидает", color: "text-orange-400", bg: "bg-orange-500/10", icon: ShieldAlert },
  completed: { label: "Завершена", color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle2 },
  error: { label: "Ошибка", color: "text-red-400", bg: "bg-red-500/10", icon: XCircle },
  cancelled: { label: "Отменена", color: "text-muted-foreground", bg: "bg-muted/20", icon: X },
};

const PHASE_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  idle: { label: "Ожидание", icon: Clock, color: "text-muted-foreground", bg: "bg-muted/30" },
  navigate: { label: "Навигация", icon: Globe, color: "text-blue-400", bg: "bg-blue-500/10" },
  observe: { label: "Сканирование", icon: Scan, color: "text-cyan-400", bg: "bg-cyan-500/10" },
  reason: { label: "Анализ", icon: Brain, color: "text-purple-400", bg: "bg-purple-500/10" },
  act: { label: "Действие", icon: Cpu, color: "text-amber-400", bg: "bg-amber-500/10" },
  awaiting_confirmation: { label: "Подтверждение", icon: ShieldAlert, color: "text-orange-400", bg: "bg-orange-500/10" },
  completed: { label: "Завершено", icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  error: { label: "Ошибка", icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
};

const EVENT_COLORS: Record<string, string> = {
  planning: "text-purple-400",
  observation: "text-cyan-400",
  reasoning: "text-purple-400",
  action: "text-amber-400",
  action_result: "text-emerald-400",
  confirm_request: "text-orange-400",
  confirm_response: "text-blue-400",
  warning: "text-yellow-400",
  error: "text-red-400",
  blocked: "text-orange-400",
  completed: "text-emerald-400",
  step_counter: "text-muted-foreground",
  preview_update: "text-teal-400",
  manual_action: "text-indigo-400",
  queue_update: "text-cyan-400",
  session_update: "text-blue-400",
};

const EVENT_ICONS: Record<string, string> = {
  planning: "◈", observation: "◉", reasoning: "◆", action: "▶",
  action_result: "✓", confirm_request: "⚡", confirm_response: "↩",
  warning: "⚠", error: "✗", blocked: "⊘", completed: "★",
  step_counter: "·", preview_update: "◎", manual_action: "⚙",
  queue_update: "◈", session_update: "◎",
};

const RISK_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: any }> = {
  low: { label: "Низкий", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", icon: CheckCircle2 },
  medium: { label: "Средний", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", icon: AlertTriangle },
  high: { label: "Высокий", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", icon: AlertOctagon },
};

const SAFETY_MODES: Record<string, { label: string; icon: any; desc: string; color: string }> = {
  readonly: { label: "Только чтение", icon: ShieldCheck, desc: "Агент только читает страницы", color: "text-emerald-500" },
  confirm: { label: "Подтверждение", icon: ShieldAlert, desc: "Спрашивает перед действием", color: "text-orange-400" },
  full: { label: "Полный доступ", icon: Shield, desc: "Все действия разрешены", color: "text-red-400" },
};

type SidecarMode = "computer" | "chat" | "research" | "terminal" | "sandbox";

// ─── Mission: the active Computer task with plan steps ───────────────────────

interface MissionStep {
  index: number;
  action: string;
  description: string;
  status: "pending" | "running" | "success" | "error" | "skipped";
}

interface ActiveMission {
  userRequest: string;
  resolvedUrl: string;
  goal: string;
  queryType: string;
  planSource: string;
  taskId: number;
  steps: MissionStep[];
  overallStatus: "running" | "completed" | "error";
  result?: string;
  startedAt: string;
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

/** Risk Card for Confirm Flow */
function RiskCard({ confirmReq, onConfirm, onDeny, isPending }: {
  confirmReq: ConfirmRequest;
  onConfirm: () => void;
  onDeny: () => void;
  isPending: boolean;
}) {
  const riskCfg = RISK_CONFIG[confirmReq.riskLevel] || RISK_CONFIG.low;
  const RiskIcon = riskCfg.icon;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" data-testid="risk-card-overlay">
      <div className={`w-[420px] rounded-xl border-2 ${riskCfg.border} bg-card shadow-2xl overflow-hidden`} data-testid="risk-card">
        <div className={`px-4 py-3 ${riskCfg.bg} flex items-center gap-3`}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${riskCfg.bg} border ${riskCfg.border}`}>
            <RiskIcon className={`h-5 w-5 ${riskCfg.color}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">Подтверждение действия</span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${riskCfg.color} ${riskCfg.border}`}>
                Риск: {riskCfg.label}
              </Badge>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Задача #{confirmReq.taskId}
            </div>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm font-medium">{confirmReq.detail}</div>
          <div className={`flex items-start gap-2 p-2.5 rounded-lg ${riskCfg.bg} border ${riskCfg.border}`}>
            <Info className={`h-4 w-4 shrink-0 mt-0.5 ${riskCfg.color}`} />
            <div>
              <div className={`text-[11px] font-bold ${riskCfg.color}`}>Оценка риска</div>
              <div className="text-[11px] text-foreground/70 mt-0.5">{confirmReq.riskReason}</div>
            </div>
          </div>
          {confirmReq.params && Object.keys(confirmReq.params).length > 0 && (
            <div className="bg-muted/30 rounded-lg p-2.5 space-y-1">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Параметры</div>
              <div className="text-[11px] font-mono"><span className="text-muted-foreground">Действие:</span> {confirmReq.action}</div>
              {Object.entries(confirmReq.params).map(([k, v]) => (
                <div key={k} className="text-[11px] font-mono"><span className="text-muted-foreground">{k}:</span> {v}</div>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex gap-2">
          <Button variant="outline" onClick={onDeny} disabled={isPending} className="flex-1 gap-1.5" data-testid="button-confirm-deny">
            <XCircle className="h-4 w-4" /> Отклонить
          </Button>
          <Button onClick={onConfirm} disabled={isPending} className="flex-1 gap-1.5" data-testid="button-confirm-approve">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Подтвердить
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Live Log Entry */
function LiveLogEntry({ event }: { event: AgentEvent }) {
  const color = EVENT_COLORS[event.type] || "text-muted-foreground";
  const icon = EVENT_ICONS[event.type] || "·";
  if (event.type === "step_counter") return null;
  const time = new Date(event.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className="log-line flex gap-2 py-0.5 border-b border-border/20 hover:bg-accent/20 transition-colors">
      <span className="text-muted-foreground/40 shrink-0 text-[11px] font-mono w-[52px]">{time}</span>
      <span className={`shrink-0 w-4 text-center ${color}`}>{icon}</span>
      <span className={`text-[11px] shrink-0 font-mono ${color} w-[72px]`}>{event.type}</span>
      <span className="text-xs break-all text-foreground/80">{event.detail}</span>
    </div>
  );
}

/** Mission Card — shows the current autonomous Computer task */
function MissionCard({ mission, onClear }: { mission: ActiveMission; onClear: () => void }) {
  const STEP_STATUS_ICON: Record<string, { icon: any; color: string }> = {
    pending:  { icon: Clock, color: "text-muted-foreground/40" },
    running:  { icon: Loader2, color: "text-blue-400" },
    success:  { icon: CheckCircle2, color: "text-emerald-400" },
    error:    { icon: XCircle, color: "text-red-400" },
    skipped:  { icon: AlertTriangle, color: "text-yellow-400" },
  };

  const QUERY_TYPE_LABEL: Record<string, string> = {
    search: "Поиск",
    open_site: "Открыть сайт",
    navigate_url: "Навигация",
    agent_task: "Задача агента",
  };

  const overallIcon =
    mission.overallStatus === "completed" ? CheckCircle2 :
    mission.overallStatus === "error" ? XCircle : Loader2;
  const overallColor =
    mission.overallStatus === "completed" ? "text-emerald-400" :
    mission.overallStatus === "error" ? "text-red-400" : "text-blue-400";

  const OIcon = overallIcon;
  const completedSteps = mission.steps.filter(s => s.status === "success" || s.status === "skipped").length;

  return (
    <div className="p-3 space-y-2" data-testid="mission-card">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <OIcon className={`h-3.5 w-3.5 shrink-0 ${overallColor} ${mission.overallStatus === "running" ? "animate-spin" : ""}`} />
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${overallColor}`}>
            {QUERY_TYPE_LABEL[mission.queryType] || mission.queryType}
          </Badge>
        </div>
        <button onClick={onClear} className="text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors" data-testid="button-clear-mission">
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* User request */}
      <div className="bg-muted/30 rounded-md px-2.5 py-1.5">
        <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Запрос</div>
        <div className="text-[11px] font-medium text-foreground/90 break-words">{mission.userRequest}</div>
      </div>

      {/* Resolved URL */}
      <div className="flex items-center gap-1.5">
        <Globe className="h-3 w-3 text-muted-foreground/40 shrink-0" />
        <span className="text-[10px] font-mono text-muted-foreground/60 truncate">{mission.resolvedUrl}</span>
      </div>

      {/* Plan steps */}
      {mission.steps.length > 0 && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">
              План {mission.planSource === "model" ? "(модель)" : "(авто)"}
            </div>
            <div className="text-[9px] text-muted-foreground/40">
              {completedSteps}/{mission.steps.length}
            </div>
          </div>
          {mission.overallStatus === "running" && (
            <Progress value={(completedSteps / Math.max(mission.steps.length, 1)) * 100} className="h-0.5 mb-1.5" />
          )}
          {mission.steps.map(step => {
            const sc = STEP_STATUS_ICON[step.status] || STEP_STATUS_ICON.pending;
            const StepIcon = sc.icon;
            return (
              <div
                key={step.index}
                className={`flex items-center gap-2 py-1 px-2 rounded ${
                  step.status === "running" ? "bg-blue-500/8 border border-blue-500/20" :
                  step.status === "success" ? "bg-emerald-500/5" :
                  step.status === "error" ? "bg-red-500/8" : ""
                }`}
                data-testid={`mission-step-${step.index}`}
              >
                <StepIcon className={`h-3 w-3 shrink-0 ${sc.color} ${step.status === "running" ? "animate-spin" : ""}`} />
                <span className={`text-[10px] flex-1 ${
                  step.status === "success" ? "text-emerald-400/80 line-through" :
                  step.status === "running" ? "text-foreground font-medium" :
                  step.status === "error" ? "text-red-400" :
                  "text-muted-foreground/60"
                }`}>{step.description}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Result */}
      {mission.result && (
        <div className={`text-[10px] px-2.5 py-1.5 rounded-md ${
          mission.overallStatus === "completed" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        }`}>
          {mission.result}
        </div>
      )}
    </div>
  );
}

// ─── Provider config for sidecar ─────────────────────────────────────────────
const SIDECAR_PROVIDERS = [
  { id: "ollama",           label: "Ollama",           local: true,  defaultBaseUrl: DEFAULT_OLLAMA_BASE_URL, defaultPort: DEFAULT_OLLAMA_PORT, hasPort: true,  hasApiKey: false, modelPlaceholder: "llama3.2, mistral…" },
  { id: "lmstudio",         label: "LM Studio",        local: true,  defaultBaseUrl: DEFAULT_LM_STUDIO_BASE_URL, defaultPort: DEFAULT_LM_STUDIO_PORT, hasPort: true,  hasApiKey: false, modelPlaceholder: EXAMPLE_LM_STUDIO_MODEL },
  { id: "openai_compatible",label: "OpenAI Compatible", local: false, defaultBaseUrl: "http://localhost", defaultPort: 8080,  hasPort: true,  hasApiKey: true,  modelPlaceholder: "gpt-3.5-turbo, custom…" },
  { id: "openai",           label: "OpenAI",           local: false, defaultBaseUrl: "https://api.openai.com", defaultPort: null, hasPort: false, hasApiKey: true,  modelPlaceholder: "gpt-4o, gpt-4-turbo…" },
  { id: "anthropic",        label: "Anthropic",        local: false, defaultBaseUrl: "https://api.anthropic.com", defaultPort: null, hasPort: false, hasApiKey: true,  modelPlaceholder: "claude-3-5-sonnet…" },
  { id: "gemini",           label: "Gemini",           local: false, defaultBaseUrl: "https://generativelanguage.googleapis.com", defaultPort: null, hasPort: false, hasApiKey: true, modelPlaceholder: "gemini-1.5-pro…" },
  { id: "minimax",          label: "MiniMax",          local: false, defaultBaseUrl: MINIMAX_BASE_URL, defaultPort: null, hasPort: false, hasApiKey: true, modelPlaceholder: EXAMPLE_MINIMAX_MODEL + ", MiniMax-M2.5…" },
] as const;

/** Collapsible Model Settings (compact) */
function ModelSettingsCollapsible() {
  const { toast } = useToast();
  const settingsQuery = useQuery<any>({ queryKey: ["/api/settings"] });
  const [form, setForm] = useState({
    providerType: "ollama" as string,
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    port: DEFAULT_OLLAMA_PORT,
    model: "",
    apiKey: "",
    temperature: "0.7",
    maxTokens: 2048,
    safetyMode: "readonly",
  });
  const [models, setModels] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const currentProvDef = SIDECAR_PROVIDERS.find(p => p.id === form.providerType) ?? SIDECAR_PROVIDERS[0];
  const isLocal = currentProvDef.local;

  useEffect(() => {
    if (settingsQuery.data && settingsQuery.data.providerType) {
      const d = settingsQuery.data;
      setForm({
        providerType: d.providerType || "ollama",
        baseUrl: d.baseUrl || DEFAULT_OLLAMA_BASE_URL,
        port: d.port || DEFAULT_OLLAMA_PORT,
        model: d.model || "",
        apiKey: d.apiKey || "",
        temperature: d.temperature || "0.7",
        maxTokens: d.maxTokens || 2048,
        safetyMode: d.safetyMode || "readonly",
      });
    }
  }, [settingsQuery.data]);

  // Auto-set defaults when provider changes
  useEffect(() => {
    const def = SIDECAR_PROVIDERS.find(p => p.id === form.providerType);
    if (!def) return;
    setForm(f => ({
      ...f,
      baseUrl: def.defaultBaseUrl,
      port: def.defaultPort ?? f.port,
    }));
    setModels([]);
  }, [form.providerType]);

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/providers/check", { providerType: form.providerType, baseUrl: form.baseUrl, port: form.port, apiKey: form.apiKey, model: form.model });
      return res.json();
    },
  });

  const modelsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/providers/models", { providerType: form.providerType, baseUrl: form.baseUrl, port: form.port, apiKey: form.apiKey, model: form.model });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.models) setModels(data.models);
      if (data.error) toast({ title: "Ошибка", description: data.error, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings", form);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Настройки сохранены" });
    },
  });

  return (
    <div className="border-t border-border/50" data-testid="model-connection-block">
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-accent/20 transition-colors"
        data-testid="button-toggle-model-settings"
      >
        <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-xs text-foreground/80 font-medium">Подключение модели</span>
          {/* Status indicator */}
          {checkMutation.data?.ok ? (
            <span className="flex items-center gap-1 text-[10px] text-emerald-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              Подключено
            </span>
          ) : form.model ? (
            <span className="text-[10px] text-muted-foreground/60 font-mono truncate">{currentProvDef.label} · {form.model}</span>
          ) : (
            <span className="text-[10px] text-amber-400/70">не настроено</span>
          )}
        </div>
        {/* Quick link to full settings */}
        <Link href="/settings">
          <span
            className="text-[10px] text-primary hover:text-primary/80 transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10 mr-1"
            onClick={e => e.stopPropagation()}
            data-testid="link-full-settings"
          >
            Полные настройки
          </span>
        </Link>
        {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
      </button>
      
      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-border/30 pt-2.5">

          {/* Provider selection — 2-row grid */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">Провайдер</label>
            {/* Local providers */}
            <div className="flex gap-1 p-0.5 bg-muted/30 rounded-md mb-1">
              {SIDECAR_PROVIDERS.filter(p => p.local).map(p => (
                <button
                  key={p.id}
                  onClick={() => setForm(f => ({ ...f, providerType: p.id }))}
                  className={`flex-1 py-1 px-2 rounded text-[11px] font-medium transition-all ${form.providerType === p.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid={`button-provider-${p.id}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {/* Cloud providers */}
            <div className="flex gap-1 p-0.5 bg-muted/20 rounded-md">
              {SIDECAR_PROVIDERS.filter(p => !p.local).map(p => (
                <button
                  key={p.id}
                  onClick={() => setForm(f => ({ ...f, providerType: p.id }))}
                  className={`flex-1 py-1 px-1 rounded text-[10px] font-medium transition-all ${form.providerType === p.id ? "bg-blue-600/80 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid={`button-provider-${p.id}`}
                  title={p.label}
                >
                  {p.label.split(" ")[0]}
                </button>
              ))}
            </div>
            {/* Honest cloud provider status */}
            {!isLocal && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-blue-400/80 bg-blue-500/8 border border-blue-500/20 rounded px-2 py-1.5">
                <span className="shrink-0">ℹ</span>
                <span>Облачный API — проверьте ключ кнопкой «Проверить». Агент использует этот провайдер для чата.</span>
              </div>
            )}
            {/* Hosted preview warning for local providers */}
            {isLocal && isHostedPreview() && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-amber-400/80 bg-amber-500/8 border border-amber-500/25 rounded px-2 py-1.5">
                <span className="shrink-0">⚠</span>
                <span>Публичный preview — localhost недоступен. Используйте облачный провайдер.</span>
              </div>
            )}
          </div>

          {/* Base URL + Port (for local + openai_compatible) */}
          {currentProvDef.hasPort && (
            <div className="flex gap-1.5">
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground mb-0.5 block">Base URL</label>
                <Input
                  value={form.baseUrl}
                  onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
                  className="h-7 text-[11px] font-mono"
                  placeholder={currentProvDef.defaultBaseUrl}
                  data-testid="input-base-url"
                />
              </div>
              <div className="w-20">
                <label className="text-[10px] text-muted-foreground mb-0.5 block">Порт</label>
                <Input
                  type="number"
                  value={form.port}
                  onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || (currentProvDef.defaultPort ?? DEFAULT_OLLAMA_PORT) }))}
                  className="h-7 text-[11px] font-mono text-center"
                  data-testid="input-port"
                />
              </div>
            </div>
          )}

          {/* API Key */}
          {currentProvDef.hasApiKey && (
            <div>
              <label className="text-[10px] text-muted-foreground mb-0.5 block">API Key</label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                  className="h-7 text-[11px] font-mono pr-7"
                  placeholder="sk-… или введите ключ"
                  data-testid="input-api-key"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey
                    ? <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>
          )}

          {/* Model field */}
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">Модель</label>
            {models.length > 0 ? (
              <Select value={form.model} onValueChange={v => setForm(f => ({ ...f, model: v }))}>
                <SelectTrigger className="h-7 text-[11px]" data-testid="select-model">
                  <SelectValue placeholder="Выберите модель..." />
                </SelectTrigger>
                <SelectContent>
                  {models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                className="h-7 text-[11px] font-mono"
                placeholder={currentProvDef.modelPlaceholder}
                data-testid="input-model"
              />
            )}
          </div>

          {/* Safety mode */}
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">Режим безопасности</label>
            <Select value={form.safetyMode} onValueChange={v => setForm(f => ({ ...f, safetyMode: v }))}>
              <SelectTrigger className="h-7 text-[11px]" data-testid="select-safety-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="readonly">Только чтение</SelectItem>
                <SelectItem value="confirm">Подтверждение</SelectItem>
                <SelectItem value="full">Полный доступ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Action buttons */}
          {isLocal && isHostedPreview() ? (
            <div className="text-[10px] text-muted-foreground/60 bg-blue-500/8 border border-blue-500/15 rounded-md px-2 py-1.5" data-testid="local-check-disabled-preview">
              Проверка недоступна в preview mode — localhost невидим. Сохранить конфигурацию можно.
            </div>
          ) : null}
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="flex-1 h-7 text-[11px] gap-1" onClick={() => checkMutation.mutate()} disabled={checkMutation.isPending || (!isLocal && !form.apiKey.trim()) || (isLocal && isHostedPreview())} data-testid="button-check-connection">
              {checkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Проверить
            </Button>
            <Button variant="outline" size="sm" className="flex-1 h-7 text-[11px] gap-1" onClick={() => modelsMutation.mutate()} disabled={modelsMutation.isPending || (!isLocal && !form.apiKey.trim()) || (isLocal && isHostedPreview())} data-testid="button-get-models">
              {modelsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Модели
            </Button>
            <Button size="sm" className="flex-1 h-7 text-[11px] gap-1" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-settings">
              {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Сохранить
            </Button>
          </div>

          {/* Status message — shown for cloud providers */}
          {checkMutation.data && (
            <div className={`text-[11px] flex items-center gap-1.5 px-2 py-1.5 rounded-md ${checkMutation.data.ok ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>
              {checkMutation.data.ok ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <XCircle className="h-3 w-3 shrink-0" />}
              <span>{checkMutation.data.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Replay Drawer */
function ReplayDrawer({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const stepsQuery = useQuery<StepData[]>({
    queryKey: ["/api/tasks", taskId, "steps"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tasks/${taskId}/steps`);
      return res.json();
    },
  });

  const steps = stepsQuery.data || [];
  const currentStep = steps[currentIdx];

  useEffect(() => {
    if (isPlaying && steps.length > 0) {
      timerRef.current = setInterval(() => {
        setCurrentIdx(prev => {
          if (prev >= steps.length - 1) { setIsPlaying(false); return prev; }
          return prev + 1;
        });
      }, 2000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, steps.length]);

  const togglePlay = () => {
    if (currentIdx >= steps.length - 1) { setCurrentIdx(0); setIsPlaying(true); }
    else { setIsPlaying(!isPlaying); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[700px] max-h-[80vh] rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()} data-testid="replay-drawer">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-card/80">
          <RotateCcw className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Replay</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">Задача #{taskId}</Badge>
          {steps.length > 0 && <span className="text-xs text-muted-foreground ml-auto">{currentIdx + 1} / {steps.length}</span>}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        {stepsQuery.isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mb-2" />
            <span className="text-xs">Загрузка шагов…</span>
          </div>
        ) : steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-muted-foreground/40">
            <RotateCcw className="h-10 w-10 mb-3 opacity-20" />
            <span className="text-xs font-medium">Нет шагов для replay</span>
          </div>
        ) : (
          <>
            <div className="flex-1 bg-black/20 relative overflow-hidden min-h-[300px]">
              {currentStep?.hasScreenshot ? (
                <img src={`/api/tasks/${taskId}/steps/${currentStep.stepIndex}/screenshot?t=${Date.now()}`} alt={`Step ${currentStep.stepIndex}`} className="w-full h-full object-contain" data-testid="img-replay-screenshot" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 p-6">
                  <Monitor className="h-10 w-10 mb-2 opacity-20" />
                  <span className="text-[11px]">Нет скриншота для этого шага</span>
                </div>
              )}
            </div>
            {currentStep && (
              <div className="px-4 py-2 border-t border-border bg-card/30">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">{currentStep.action}</Badge>
                  <Badge variant={currentStep.status === "success" ? "default" : "destructive"} className="text-[10px] px-1 py-0">{currentStep.status}</Badge>
                </div>
                <div className="text-[11px] text-foreground/70 line-clamp-2">{currentStep.detail}</div>
              </div>
            )}
            <div className="px-4 py-2 border-t border-border flex items-center gap-2 bg-card/50">
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentIdx === 0} onClick={() => { setIsPlaying(false); setCurrentIdx(0); }}><StepBack className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentIdx === 0} onClick={() => { setIsPlaying(false); setCurrentIdx(Math.max(0, currentIdx - 1)); }}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={togglePlay}>
                {isPlaying ? <PauseCircle className="h-5 w-5 text-primary" /> : <PlayCircle className="h-5 w-5 text-primary" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentIdx >= steps.length - 1} onClick={() => { setIsPlaying(false); setCurrentIdx(Math.min(steps.length - 1, currentIdx + 1)); }}><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentIdx >= steps.length - 1} onClick={() => { setIsPlaying(false); setCurrentIdx(steps.length - 1); }}><StepForward className="h-4 w-4" /></Button>
              <div className="flex-1 mx-2"><Progress value={steps.length > 1 ? (currentIdx / (steps.length - 1)) * 100 : 100} className="h-1.5" /></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Terminal Panel ─────────────────────────────────────────────────────────

function TerminalPanel({ sessionId }: { sessionId: string }) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Array<{cmd: string; out: string; err: string; code: number | null; ms: number; blocked?: boolean}>>([]);
  const [isRunning, setIsRunning] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const filesQuery = useQuery<{files: string[]; cwd: string}>({
    queryKey: ["/api/terminal/files", sessionId],
    queryFn: async () => { const res = await apiRequest("GET", `/api/terminal/files?sessionId=${sessionId}`); return res.json(); },
    refetchInterval: 5000,
  });

  const runCmd = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setInput("");
    setIsRunning(true);
    try {
      const res = await apiRequest("POST", "/api/terminal/exec", { command: cmd, sessionId, timeout: 15000 });
      const data = await res.json();
      if (!res.ok) {
        // Server returned error — show it as a terminal error entry
        setHistory(prev => [...prev, {
          cmd,
          out: "",
          err: data.error || `Ошибка сервера ${res.status}`,
          code: 1,
          ms: 0,
          blocked: false,
        }]);
      } else {
        setHistory(prev => [...prev, { cmd, out: data.stdout || "", err: data.stderr || "", code: data.exitCode, ms: data.durationMs || 0, blocked: data.blocked }]);
      }
      setTimeout(() => outputRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      if (cmd.startsWith("ls") || cmd.startsWith("mkdir") || cmd.startsWith("touch") || cmd.startsWith("rm") || cmd.startsWith("cp") || cmd.startsWith("mv")) {
        queryClient.invalidateQueries({ queryKey: ["/api/terminal/files", sessionId] });
      }
    } catch (err: any) {
      setHistory(prev => [...prev, { cmd, out: "", err: `Ошибка: ${err.message}`, code: 1, ms: 0, blocked: false }]);
      toast({ title: "Ошибка терминала", description: err.message, variant: "destructive" });
    } finally { setIsRunning(false); }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="terminal-panel">
      {/* Sandbox info */}
      <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground truncate flex-1">
          cwd: {filesQuery.data?.cwd || "..."}
        </span>
        <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">
          {filesQuery.data?.files.length || 0} файлов
        </Badge>
      </div>
      {/* Files list */}
      {filesQuery.data && filesQuery.data.files.length > 0 && (
        <div className="px-3 py-1 border-b border-border/50 flex flex-wrap gap-1">
          {filesQuery.data.files.map(f => (
            <Badge key={f} variant="outline" className="text-[9px] font-mono px-1 py-0">{f}</Badge>
          ))}
        </div>
      )}
      {/* Output area */}
      <ScrollArea className="flex-1 bg-black/40">
        <div className="p-2 space-y-2 font-mono text-[11px]">
          {history.length === 0 && (
            <div className="text-muted-foreground/40 py-6 text-center space-y-1">
              <p className="text-muted-foreground/60 text-[11px]">Shell-сандбокс</p>
              {filesQuery.data?.cwd ? (
                <p className="text-[10px] font-mono text-muted-foreground/30">{filesQuery.data.cwd}</p>
              ) : (
                <p className="text-[10px] text-muted-foreground/30">Загрузка сессии…</p>
              )}
              <p className="text-[10px] text-muted-foreground/25 mt-2">Пример: ls, pwd, python3 -c &quot;print(1+1)&quot;</p>
            </div>
          )}
          {history.map((h, i) => (
            <div key={i} className={`space-y-0.5 pb-1 border-b border-border/10 last:border-0 ${
              h.blocked ? "" : h.code === 0 ? "" : h.code !== null ? "" : ""
            }`}>
              <div className="flex items-center gap-1.5">
                <span className={h.blocked ? "text-orange-400/60" : h.code === 0 || h.code === null ? "text-primary/60" : "text-red-400/60"}>$</span>
                <span className="text-foreground/90">{h.cmd}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-muted-foreground/25 text-[9px]">{h.ms}ms</span>
                  {h.blocked ? (
                    <span className="text-[9px] text-orange-400/70 bg-orange-500/10 px-1 rounded">BLOCKED</span>
                  ) : h.code !== null && (
                    <span className={`text-[9px] px-1 rounded ${
                      h.code === 0 ? "text-emerald-400/70 bg-emerald-500/10" : "text-red-400/70 bg-red-500/10"
                    }`}>exit {h.code}</span>
                  )}
                </div>
              </div>
              {h.blocked && (
                <pre className="text-orange-400/80 pl-3 whitespace-pre-wrap break-all">{h.err}</pre>
              )}
              {!h.blocked && h.out && (
                <pre className="text-emerald-400/80 pl-3 whitespace-pre-wrap break-all">{h.out}</pre>
              )}
              {!h.blocked && h.err && (
                <pre className="text-red-400/80 pl-3 whitespace-pre-wrap break-all">{h.err}</pre>
              )}
            </div>
          ))}
          <div ref={outputRef} />
        </div>
      </ScrollArea>
      {/* Input */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border bg-black/30">
        <span className="text-primary/60 font-mono text-[11px] shrink-0">$</span>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !isRunning) runCmd(); }}
          placeholder="команда..."
          className="flex-1 bg-transparent text-[11px] font-mono outline-none placeholder:text-muted-foreground/30"
          disabled={isRunning}
          data-testid="input-terminal"
        />
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={runCmd} disabled={isRunning || !input.trim()} data-testid="button-terminal-run">
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

// ─── Code Sandbox Panel ──────────────────────────────────────────────────────

const CODE_EXAMPLES: Record<string, { label: string; code: string }> = {
  javascript: { label: "JS пример", code: `// Простой JS
const nums = [1, 2, 3, 4, 5];
const sum = nums.reduce((a, b) => a + b, 0);
console.log('Сумма:', sum);
console.log('Node version:', process.version);` },
  python: { label: "Python пример", code: `# Простой Python
nums = [1, 2, 3, 4, 5]
print('Сумма:', sum(nums))
import sys
print('Python:', sys.version.split()[0])` },
  bash: { label: "Bash пример", code: `#!/bin/bash
echo "Дата: $(date)"
echo "Директория: $(pwd)"
ls -la 2>/dev/null | head -10` },
};

interface SandboxInjection {
  code: string;
  lang: "javascript" | "python" | "bash";
  result?: { output: string; error: string; exitCode: number | null; durationMs: number; language: string } | null;
  token: number; // increment to re-apply same code
}

function SandboxPanel({ sessionId, injection }: { sessionId: string; injection?: SandboxInjection | null }) {
  const { toast } = useToast();
  const [lang, setLang] = useState<"javascript" | "python" | "bash">("javascript");
  const [code, setCode] = useState(CODE_EXAMPLES.javascript.code);
  const [result, setResult] = useState<{output: string; error: string; exitCode: number | null; durationMs: number; language: string} | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Apply injected code/lang/result when a new injection arrives
  useEffect(() => {
    if (!injection) return;
    setLang(injection.lang);
    setCode(injection.code);
    if (injection.result !== undefined) {
      setResult(injection.result ?? null);
    }
  }, [injection?.token]);

  const runCode = async () => {
    if (!code.trim()) return;
    setIsRunning(true);
    setResult(null);
    try {
      const res = await apiRequest("POST", "/api/sandbox/run", { code, language: lang, sessionId, timeout: 15000 });
      const data = await res.json();
      if (!res.ok) {
        // API returned error JSON
        setResult({
          output: "",
          error: data.error || `Ошибка сервера: ${res.status}`,
          exitCode: 1,
          durationMs: 0,
          language: lang,
        });
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setResult({
        output: "",
        error: `Ошибка выполнения: ${err.message}`,
        exitCode: 1,
        durationMs: 0,
        language: lang,
      });
      toast({ title: "Ошибка sandbox", description: err.message, variant: "destructive" });
    } finally { setIsRunning(false); }
  };

  const handleLangChange = (l: "javascript" | "python" | "bash") => {
    setLang(l);
    setCode(CODE_EXAMPLES[l].code);
    setResult(null);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="sandbox-panel">
      {/* Lang selector */}
      <div className="flex gap-0.5 p-1.5 border-b border-border shrink-0">
        {(["javascript", "python", "bash"] as const).map(l => (
          <button
            key={l}
            onClick={() => handleLangChange(l)}
            className={`flex-1 py-1 px-2 rounded text-[10px] font-medium transition-all ${
              lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            }`}
            data-testid={`button-lang-${l}`}
          >
            {l === "javascript" ? "JS" : l === "python" ? "Python" : "Bash"}
          </button>
        ))}
      </div>
      {/* Code editor (textarea) */}
      <div className="flex-1 flex flex-col min-h-0 p-2">
        <Textarea
          value={code}
          onChange={e => setCode(e.target.value)}
          className="flex-1 font-mono text-[11px] bg-black/30 resize-none min-h-[120px] text-foreground"
          placeholder="Введите код..."
          spellCheck={false}
          data-testid="input-sandbox-code"
        />
      </div>
      {/* Run button */}
      <div className="px-2 pb-2 shrink-0">
        <Button
          className="w-full h-8 text-xs gap-1.5"
          onClick={runCode}
          disabled={isRunning || !code.trim()}
          data-testid="button-sandbox-run"
        >
          {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Запустить
        </Button>
      </div>
      {/* Output */}
      {isRunning && (
        <div className="border-t border-border px-3 py-3 bg-black/20 shrink-0 space-y-1.5" data-testid="sandbox-output-loading">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin text-primary/60" />
            <span className="text-[10px] text-muted-foreground">Выполнение…</span>
          </div>
          <div className="h-2 bg-muted/20 rounded animate-pulse w-3/4" />
          <div className="h-2 bg-muted/20 rounded animate-pulse w-1/2" />
        </div>
      )}
      {!isRunning && result && (
        <div className="border-t border-border px-2 py-1.5 bg-black/30 max-h-48 overflow-auto shrink-0" data-testid="sandbox-output">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
              result.exitCode === 0 ? "bg-emerald-500/10 text-emerald-400" :
              result.exitCode === null ? "bg-muted/30 text-muted-foreground" :
              "bg-red-500/10 text-red-400"
            }`}>
              exit {result.exitCode ?? "?"}
            </span>
            <span className="text-[9px] text-muted-foreground">{result.durationMs}ms</span>
            <span className="text-[9px] text-muted-foreground capitalize">{result.language}</span>
          </div>
          {result.output ? (
            <pre className="text-[10px] font-mono text-emerald-400/90 whitespace-pre-wrap break-all">{result.output}</pre>
          ) : !result.error ? (
            <p className="text-[10px] text-muted-foreground/40 italic">Нет вывода</p>
          ) : null}
          {result.error && (
            <pre className="text-[10px] font-mono text-red-400/90 whitespace-pre-wrap break-all">{result.error}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Provider Connect Block ──────────────────────────────────────────────────
/** Prominent block shown on main screen to let user connect a model */
function ProviderConnectBlock() {
  const settingsQuery = useQuery<any>({ queryKey: ["/api/settings"] });
  const [provStatus, setProvStatus] = useState<{ ok: boolean; checked: boolean; checking: boolean }>({ ok: false, checked: false, checking: false });

  useEffect(() => {
    if (!settingsQuery.data) return;
    const s = settingsQuery.data;
    // For local providers in hosted preview, skip auto-check (it will always fail)
    if (LOCAL_PROVIDERS.includes(s.providerType) && isHostedPreview()) return;
    setProvStatus(prev => ({ ...prev, checking: true }));
    apiRequest("POST", "/api/providers/check", {
      providerType: s.providerType || "ollama",
      baseUrl: s.baseUrl || DEFAULT_OLLAMA_BASE_URL,
      port: s.port || DEFAULT_OLLAMA_PORT,
      apiKey: s.apiKey || "",
      model: s.model || "",
    })
      .then(r => r.json())
      .then(d => setProvStatus({ ok: !!d.ok, checked: true, checking: false }))
      .catch(() => setProvStatus({ ok: false, checked: true, checking: false }));
  }, [settingsQuery.data]);

  const settings = settingsQuery.data;
  const providerLabel = settings?.providerType
    ? SIDECAR_PROVIDERS.find(p => p.id === settings.providerType)?.label ?? settings.providerType
    : null;
  const model = settings?.model;
  const isConfigOnly = settings?.providerType && !LOCAL_PROVIDERS.includes(settings.providerType);

  return (
    <div className="mb-5 rounded-xl border border-border/60 bg-card/50 overflow-hidden" data-testid="provider-connect-block">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Подключение модели</span>
        </div>
        <Link href="/settings">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" data-testid="button-open-settings">
            <Settings className="h-3 w-3" />
            Настроить
          </Button>
        </Link>
      </div>

      {/* Status */}
      <div className="px-4 py-3">
        {settingsQuery.isLoading || provStatus.checking ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Проверка подключения…
          </div>
        ) : isConfigOnly ? (
          <div className="flex items-center gap-2 text-xs text-blue-400/80">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <div>
              <span className="font-medium">{providerLabel}</span>{model ? <> · <code className="font-mono text-[11px]">{model}</code></> : null}
              {" "}<span className="text-muted-foreground">— конфигурация сохранена. Агент работает только через Ollama / LM Studio.</span>
            </div>
          </div>
        ) : !settings?.model ? (
          <div className="flex items-center gap-2 text-xs text-amber-400/90">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Модель не настроена. Откройте <Link href="/settings"><span className="underline cursor-pointer">Настройки</span></Link> и выберите провайдер.</span>
          </div>
        ) : provStatus.checked && provStatus.ok ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-medium">{providerLabel}</span>{" "}подключен
              {model && <> · <code className="font-mono text-[11px] bg-emerald-500/10 px-1 rounded">{model}</code></>}
            </span>
          </div>
        ) : provStatus.checked && !provStatus.ok ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-amber-400/90">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-medium">{providerLabel}</span> недоступен — деградированный режим.
                {" "}Задачи будут выполняться без LLM.
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Server className="h-3.5 w-3.5 shrink-0" />
            <span>
              {providerLabel
                ? <><span className="font-medium">{providerLabel}</span>{model ? <> · <code className="font-mono text-[11px]">{model}</code></> : " · не проверено"}</>
                : "Провайдер не выбран"}
            </span>
          </div>
        )}

        {/* Provider options hint when not configured */}
        {!settings?.model && !settingsQuery.isLoading && (
          <div className="mt-3 space-y-2">
            {isHostedPreview() && (
              <div className="text-[10px] text-amber-400/80 bg-amber-500/8 border border-amber-500/20 rounded px-2 py-1.5 flex items-start gap-1.5">
                <span className="shrink-0">⚠</span>
                <span>Публичный preview — Ollama/LM Studio требуют локального запуска. Рекомендуется API Key.</span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Ollama", hint: `${DEFAULT_OLLAMA_BASE_URL}:${DEFAULT_OLLAMA_PORT}`, local: true },
                { label: "LM Studio", hint: `${DEFAULT_LM_STUDIO_BASE_URL}:${DEFAULT_LM_STUDIO_PORT}`, local: true },
                { label: "API Key", hint: "OpenAI / Claude / Gemini", local: false },
              ].map(opt => (
                <Link key={opt.label} href="/settings">
                  <div
                    className={`border rounded-lg p-2 text-center transition-colors cursor-pointer ${
                      opt.local && isHostedPreview()
                        ? "border-border/30 opacity-50 hover:opacity-70"
                        : "border-border/50 hover:border-primary/40 hover:bg-primary/5"
                    }`}
                    data-testid={`card-provider-hint-${opt.label.toLowerCase().replace(' ', '-')}`}
                  >
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{opt.hint}</div>
                    {opt.local && isHostedPreview() && (
                      <div className="text-[9px] text-amber-400/60 mt-0.5">только локально</div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ControlCenter() {
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [, navigate] = useLocation();

  // --- UI State ---
  const [sidecarOpen, setSidecarOpen] = useState(true);
  const [sidecarMode, setSidecarMode] = useState<SidecarMode>("computer");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [replayTaskId, setReplayTaskId] = useState<number | null>(null);
  const [activeMission, setActiveMission] = useState<ActiveMission | null>(null);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  // --- Sandbox injection state (for code intent routing) ---
  const [sandboxInjection, setSandboxInjection] = useState<SandboxInjection | null>(null);
  // Monotonic counter for sandbox injection tokens — prevents Date.now() collisions
  const sandboxTokenRef = useRef(0);

  // --- Command input ---
  const [commandValue, setCommandValue] = useState("");
  const [commandHint, setCommandHint] = useState<string | null>(null);

  // --- Explicit main-function inputs (hero panel) ---
  const [codeQuery, setCodeQuery] = useState("");
  const [agentQuery, setAgentQuery] = useState("");
  const [browsingHistory, setBrowsingHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // --- Task state ---
  const [targetUrl, setTargetUrl] = useState("");
  const [goalText, setGoalText] = useState("");
  const [maxSteps, setMaxSteps] = useState(10);
  const [isRunning, setIsRunning] = useState(false);

  // --- Workspace state ---
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(1);
  const [activeSession, setActiveSession] = useState("default");
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  // --- SSE state ---
  const [liveEvents, setLiveEvents] = useState<AgentEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState("idle");
  const [currentStep, setCurrentStep] = useState(0);
  const [currentMaxSteps, setCurrentMaxSteps] = useState(0);
  const [lastSnapshot, setLastSnapshot] = useState<PageSnapshot | null>(null);
  const [nextAction, setNextAction] = useState<any>(null);

  // --- Preview state ---
  const [previewSync, setPreviewSync] = useState<PreviewSync | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // --- Element selection ---
  const [selectedElement, setSelectedElementState] = useState<DOMElement | null>(null);

  // --- Action console ---
  const [actionResult, setActionResult] = useState<any>(null);
  const [actionExecuting, setActionExecuting] = useState(false);

  // --- Confirm state ---
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  // --- Scroll ref ---
  const sidecarLogRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ──
  const settingsQuery = useQuery<any>({ queryKey: ["/api/settings"] });
  const workspacesQuery = useQuery<Workspace[]>({ queryKey: ["/api/workspaces"], refetchInterval: 10000 });
  const tasksQuery = useQuery<AgentTask[]>({
    queryKey: ["/api/tasks", activeWorkspaceId],
    queryFn: async () => { const res = await apiRequest("GET", `/api/tasks?workspaceId=${activeWorkspaceId}`); return res.json(); },
    refetchInterval: 3000,
  });
  const healthQuery = useQuery<any>({ queryKey: ["/api/health"] });
  const sessionsQuery = useQuery<any[]>({
    queryKey: ["/api/sessions", activeWorkspaceId],
    queryFn: async () => { const res = await apiRequest("GET", `/api/sessions?workspaceId=${activeWorkspaceId}`); return res.json(); },
    refetchInterval: 5000,
  });
  const tabsQuery = useQuery<SessionTab[]>({
    queryKey: ["/api/tabs", activeWorkspaceId, activeSession],
    queryFn: async () => { const res = await apiRequest("GET", `/api/tabs?workspaceId=${activeWorkspaceId}&sessionId=${activeSession}`); return res.json(); },
    refetchInterval: 5000,
  });

  // ── Load initial workspace ──
  useEffect(() => {
    if (workspacesQuery.data && workspacesQuery.data.length > 0) {
      const active = workspacesQuery.data.find(w => w.isActive === 1);
      if (active) setActiveWorkspaceId(active.id);
    }
  }, [workspacesQuery.data]);

  useEffect(() => {
    if (tabsQuery.data && tabsQuery.data.length > 0) {
      const active = tabsQuery.data.find(t => t.isActive === 1);
      if (active) setActiveTabId(active.id);
      else setActiveTabId(tabsQuery.data[0].id);
    }
  }, [tabsQuery.data]);

  // Provider status — silent auto-check when settings load
  const [providerStatus, setProviderStatus] = useState<{ ok: boolean; checked: boolean; checking: boolean }>({ ok: false, checked: false, checking: false });

  useEffect(() => {
    if (!settingsQuery.data) return;
    const s = settingsQuery.data;
    // Skip auto-check for local providers in hosted preview
    if (LOCAL_PROVIDERS.includes(s.providerType) && isHostedPreview()) return;
    setProviderStatus(prev => ({ ...prev, checking: true }));
    apiRequest("POST", "/api/providers/check", { providerType: s.providerType || "ollama", baseUrl: s.baseUrl || DEFAULT_OLLAMA_BASE_URL, port: s.port || DEFAULT_OLLAMA_PORT, apiKey: s.apiKey || "", model: s.model || "" })
      .then(r => r.json())
      .then(d => setProviderStatus({ ok: !!d.ok, checked: true, checking: false }))
      .catch(() => setProviderStatus({ ok: false, checked: true, checking: false }));
  }, [settingsQuery.data]);

  // Provider check (manual, used in ModelSettings collapsible)
  const checkMutation = useMutation({
    mutationFn: async () => {
      const s = settingsQuery.data;
      const res = await apiRequest("POST", "/api/providers/check", { providerType: s?.providerType || "ollama", baseUrl: s?.baseUrl || DEFAULT_OLLAMA_BASE_URL, port: s?.port || DEFAULT_OLLAMA_PORT, apiKey: s?.apiKey || "", model: s?.model || "" });
      return res.json();
    },
    onSuccess: (d) => setProviderStatus({ ok: !!d.ok, checked: true, checking: false }),
  });

  // Confirm mutation
  const confirmMutation = useMutation({
    mutationFn: async (data: { taskId: number; approved: boolean }) => { const res = await apiRequest("POST", "/api/agent/confirm", data); return res.json(); },
    onSuccess: () => { setConfirmRequest(null); },
  });

  // Create workspace
  const createWorkspaceMutation = useMutation({
    mutationFn: async (name: string) => { const res = await apiRequest("POST", "/api/workspaces", { name, description: "" }); return res.json(); },
    onSuccess: (ws) => { queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] }); toast({ title: "Workspace создан", description: ws.name }); },
  });

  // Create tab
  const createTabMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tabs", { workspaceId: activeWorkspaceId, sessionId: activeSession, label: `Tab ${(tabsQuery.data?.length || 0) + 1}`, url: "" });
      return res.json();
    },
    onSuccess: (tab) => { queryClient.invalidateQueries({ queryKey: ["/api/tabs", activeWorkspaceId, activeSession] }); setActiveTabId(tab.id); },
  });

  // Manual action
  const handleManualAction = useCallback(async (action: string, params: Record<string, string>) => {
    setActionExecuting(true);
    try {
      const res = await apiRequest("POST", "/api/action/execute", { action, params, sessionId: activeSession });
      const data = await res.json();
      setActionResult(data.result);
      setLiveEvents(prev => [...prev, { type: "manual_action", taskId: 0, detail: `[Computer] ${action}: ${data.result?.detail || ""}`, timestamp: new Date().toISOString() }]);
      fetchPreview();
    } catch (err: any) {
      setActionResult({ status: "error", detail: err.message });
    } finally { setActionExecuting(false); }
  }, [activeSession]);

  // Element selection
  const handleSelectElement = useCallback(async (el: DOMElement | null) => {
    setSelectedElementState(el);
    try { await apiRequest("POST", "/api/element/select", { element: el, sessionId: activeSession }); } catch {}
  }, [activeSession]);

  // Fetch preview
  const fetchPreview = useCallback(async () => {
    try {
      const res = await apiRequest("GET", `/api/preview?sessionId=${activeSession}`);
      const data = await res.json();
      setPreviewSync(data);
      if (data.snapshot) setLastSnapshot(data.snapshot);
    } catch {}
  }, [activeSession]);

  // Refresh preview
  const handleRefreshPreview = useCallback(async () => {
    setPreviewLoading(true);
    try { await apiRequest("POST", "/api/preview/refresh"); await fetchPreview(); } catch {}
    setPreviewLoading(false);
  }, [fetchPreview]);

  // Workspace switch
  const handleWorkspaceSwitch = useCallback(async (id: number) => {
    setActiveWorkspaceId(id);
    try { await apiRequest("POST", `/api/workspaces/${id}/activate`); } catch {}
    queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", id] });
    setActiveSession("default");
    setLiveEvents([]);
    setLastSnapshot(null);
    setPreviewSync(null);
    setSelectedElementState(null);
    setCurrentPhase("idle");
    setCurrentStep(0);
    setCurrentMaxSteps(0);
    setActiveTabId(null);
  }, []);

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [showWorkspaceInput, setShowWorkspaceInput] = useState(false);
  const handleCreateWorkspace = useCallback(() => {
    setShowWorkspaceInput(true);
  }, []);
  const handleWorkspaceSubmit = useCallback(() => {
    if (newWorkspaceName.trim()) {
      createWorkspaceMutation.mutate(newWorkspaceName.trim());
      setNewWorkspaceName("");
      setShowWorkspaceInput(false);
    }
  }, [newWorkspaceName, createWorkspaceMutation]);

  const handleSessionSwitch = useCallback((sessionId: string) => {
    setActiveSession(sessionId);
    setLiveEvents([]);
    setLastSnapshot(null);
    setPreviewSync(null);
    setSelectedElementState(null);
    setCurrentPhase("idle");
    setCurrentStep(0);
    setCurrentMaxSteps(0);
    setActiveTabId(null);
    setTimeout(() => fetchPreview(), 100);
  }, [fetchPreview]);

  const handleCreateSession = useCallback(() => { handleSessionSwitch(`session-${Date.now()}`); }, [handleSessionSwitch]);

  const handleTabSwitch = useCallback(async (tabId: number) => {
    setActiveTabId(tabId);
    try { await apiRequest("POST", `/api/tabs/${tabId}/activate`); } catch {}
    queryClient.invalidateQueries({ queryKey: ["/api/tabs", activeWorkspaceId, activeSession] });
  }, [activeWorkspaceId, activeSession]);

  const handleCreateTab = useCallback(() => { createTabMutation.mutate(); }, [createTabMutation]);

  const handleExportSession = useCallback(() => {
    window.open(`/api/export/session?workspaceId=${activeWorkspaceId}&sessionId=${activeSession}`, "_blank");
  }, [activeWorkspaceId, activeSession]);

  // SSE
  useEffect(() => {
    const evtSource = new EventSource("/api/events");
    evtSource.onmessage = (event) => {
      try {
        const data: AgentEvent = JSON.parse(event.data);
        if (data.type === "connected") return;
        setLiveEvents(prev => [...prev, data]);
        if (data.phase) setCurrentPhase(data.phase);
        if (data.step !== undefined) setCurrentStep(data.step);
        if (data.maxSteps !== undefined) setCurrentMaxSteps(data.maxSteps);
        const eventSession = data.data?.sessionId;
        if (data.type === "observation" && data.data?.snapshot) { if (!eventSession || eventSession === activeSession) setLastSnapshot(data.data.snapshot); }
        if (data.type === "action_result" && data.data?.resultData?.snapshot) { if (!eventSession || eventSession === activeSession) setLastSnapshot(data.data.resultData.snapshot); }
        if (data.type === "reasoning" && data.data?.nextAction) setNextAction(data.data.nextAction);
        if (data.type === "preview_update") {
          const ps = data.data?.sessionId || "default";
          if (ps === activeSession) {
            setPreviewSync({ url: data.data?.url || "", syncId: data.data?.syncId || 0, timestamp: data.data?.timestamp || data.timestamp, currentAction: data.data?.currentAction || null, hasScreenshot: data.data?.hasScreenshot || false, snapshot: data.data?.snapshot || null, sessionId: ps });
            if (data.data?.snapshot) setLastSnapshot(data.data.snapshot);
          }
        }
        if (data.type === "confirm_request") {
          setConfirmRequest({ taskId: data.taskId, sessionId: data.data?.sessionId || "default", step: data.step || 0, action: data.data?.action || "", params: data.data?.params, detail: data.detail, riskLevel: data.data?.riskLevel || "low", riskReason: data.data?.riskReason || "" });
        }
        if (data.type === "completed") {
          setIsRunning(false); setCurrentPhase("completed"); setNextAction(null);
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
          queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
          fetchPreview();
          // Mark mission as completed
          setActiveMission(prev => {
            if (!prev || prev.taskId !== data.taskId) return prev;
            const completed = data.data?.success !== false;
            return {
              ...prev,
              overallStatus: completed ? "completed" : "error",
              result: completed ? "Задача выполнена" : (data.detail || "Завершено с ошибкой"),
              steps: prev.steps.map(s => s.status === "running" ? { ...s, status: "success" as const } : s),
            };
          });
        }
        if (data.type === "queue_update") {
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
          queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
          queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
          if (data.data?.status === "running") { setIsRunning(true); setCurrentPhase("navigate"); }
        }
        // Drive mission step progress from action events
        if ((data.type === "action" || data.type === "action_result") && data.step !== undefined) {
          setActiveMission(prev => {
            if (!prev) return prev;
            const stepIdx = data.step!;
            return {
              ...prev,
              steps: prev.steps.map((s, i) => {
                if (data.type === "action" && i === stepIdx) return { ...s, status: "running" as const };
                if (data.type === "action_result" && i === stepIdx) {
                  const ok = data.data?.status !== "error";
                  return { ...s, status: ok ? "success" as const : "error" as const };
                }
                if (i < stepIdx && s.status === "pending") return { ...s, status: "success" as const };
                return s;
              }),
            };
          });
        }
      } catch {}
    };
    evtSource.onerror = () => {};
    return () => evtSource.close();
  }, [fetchPreview, activeSession]);

  // Auto scroll sidecar log
  useEffect(() => { sidecarLogRef.current?.scrollIntoView({ behavior: "smooth" }); }, [liveEvents]);

  // Run agent (direct: url + goal)
  const runMutation = useMutation({
    mutationFn: async (data: { url: string; goal: string; maxSteps: number; sessionId: string; workspaceId: number }) => {
      const res = await apiRequest("POST", "/api/agent/run", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      if (data.sessionId && data.sessionId !== activeSession) setActiveSession(data.sessionId);
      toast({ title: "Задача добавлена", description: `#${data.task?.id} в очереди` });
    },
    onError: (err: Error) => { toast({ title: "Ошибка", description: err.message, variant: "destructive" }); },
  });

  // Computer run: natural language → auto intent → agent
  const computerRunMutation = useMutation({
    mutationFn: async (data: { query: string; sessionId: string; workspaceId: number; maxSteps?: number }) => {
      const res = await apiRequest("POST", "/api/computer/run", data);
      return res.json();
    },
    onMutate: (variables) => {
      // Immediately show a pending mission so the panel feels instant
      setActiveMission({
        userRequest: variables.query,
        resolvedUrl: "",
        goal: "",
        queryType: "agent_task",
        planSource: "heuristic",
        taskId: 0,
        steps: [
          { index: 0, action: "navigate", description: "Анализ запроса…", status: "running" },
        ],
        overallStatus: "running",
        startedAt: new Date().toISOString(),
      });
      setSidecarMode("computer");
      if (!sidecarOpen) setSidecarOpen(true);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      if (data.sessionId && data.sessionId !== activeSession) setActiveSession(data.sessionId);
      setTargetUrl(data.resolvedUrl || "");
      setGoalText(data.goal || "");

      // Populate the mission card with actual plan steps from the server
      if (data.task && data.planSteps) {
        setActiveMission({
          userRequest: variables.query,
          resolvedUrl: data.resolvedUrl || "",
          goal: data.goal || "",
          queryType: data.queryType || "agent_task",
          planSource: data.planSource || "heuristic",
          taskId: data.task.id,
          steps: (data.planSteps as MissionStep[]).map((s: MissionStep) => ({
            ...s,
            status: "pending" as const,
          })),
          overallStatus: "running",
          startedAt: new Date().toISOString(),
        });
      }

      setLiveEvents(prev => [...prev, {
        type: "action", taskId: data.task?.id || 0,
        detail: `[Computer] задача #${data.task?.id}: ${data.resolvedUrl}`,
        timestamp: new Date().toISOString(),
      }]);
    },
    onError: (err: Error) => {
      setActiveMission(prev => prev ? { ...prev, overallStatus: "error", result: err.message } : null);
      toast({ title: "Ошибка Computer", description: err.message, variant: "destructive" });
    },
  });

  // ── Code intent handler: open dedicated Code Window page ────────────────
  // Navigates to /#/code?q=<encoded query> — a full-screen, code-first page.
  // Does NOT open a browser / agent task. Existing browser flows are unaffected.
  const handleCodeIntent = useCallback((query: string) => {
    const encoded = encodeURIComponent(query.trim());
    navigate(`/code?q=${encoded}`);
  }, [navigate]);

  // ── Explicit hero panel: Code Generator ──────────────────────────────────
  // Direct submit — no intent parsing, always routes to code workflow.
  const handleCodeSubmit = useCallback(() => {
    const raw = codeQuery.trim();
    if (!raw) return;
    setCodeQuery("");
    const encoded = encodeURIComponent(raw);
    navigate(`/code?q=${encoded}`);
  }, [codeQuery, navigate]);

  // ── Explicit hero panel: Browser Agent ──────────────────────────────────
  // Direct submit — no intent parsing, always routes to browser agent workflow.
  const handleAgentSubmit = useCallback(() => {
    const raw = agentQuery.trim();
    if (!raw) return;
    setAgentQuery("");
    computerRunMutation.mutate({ query: raw, sessionId: activeSession, workspaceId: activeWorkspaceId, maxSteps });
  }, [agentQuery, computerRunMutation, activeSession, activeWorkspaceId, maxSteps]);

  // ── CORE: Command Submit Handler (intent parsing) ──
  const handleCommandSubmit = useCallback(() => {
    const raw = commandValue.trim();
    if (!raw) return;
    setCommandValue("");

    // ── Code intent guard: route to local sandbox, skip browser agent ──
    // This MUST run before computerRunMutation so code tasks never open Google/GitHub.
    if (isCodeIntent(raw)) {
      handleCodeIntent(raw);
      return;
    }

    // Browser/agent tasks go through computerRunMutation —
    // this creates an agent task with a visible plan, resolves URL server-side,
    // and shows mission card with step-by-step execution.
    computerRunMutation.mutate({ query: raw, sessionId: activeSession, workspaceId: activeWorkspaceId, maxSteps });

    // For instant UX feedback, also do a local preview navigate for known site/URL patterns
    const intent = parseIntent(raw);
    if ((intent.type === "open_site" || intent.type === "navigate_url" || intent.type === "search") && intent.url) {
      setTargetUrl(intent.url);
      setBrowsingHistory(prev => [...prev, intent.url!]);
      setHistoryIdx(browsingHistory.length);
      // Fire-and-forget browser navigate for immediate visual feedback
      handleManualAction("navigate", { url: intent.url }).catch(() => {});
    }
  }, [commandValue, maxSteps, activeSession, activeWorkspaceId, browsingHistory, handleManualAction, computerRunMutation, handleCodeIntent]);

  // Example command click — detect intent and route accordingly
  const handleExampleClick = useCallback((text: string) => {
    setCommandValue(text);
    // Small delay so the input shows the text before submitting
    setTimeout(() => {
      setCommandValue("");

      // ── Code intent guard: route to sandbox, skip browser agent ──
      if (isCodeIntent(text)) {
        handleCodeIntent(text);
        return;
      }

      computerRunMutation.mutate({ query: text, sessionId: activeSession, workspaceId: activeWorkspaceId, maxSteps });
      const intent = parseIntent(text);
      if ((intent.type === "open_site" || intent.type === "navigate_url" || intent.type === "search") && intent.url) {
        setTargetUrl(intent.url);
        setBrowsingHistory(prev => [...prev, intent.url!]);
        setHistoryIdx(prev => prev + 1);
        handleManualAction("navigate", { url: intent.url }).catch(() => {});
      }
    }, 80);
  }, [computerRunMutation, handleManualAction, activeSession, activeWorkspaceId, maxSteps, browsingHistory, handleCodeIntent]);

  const handleConfirm = (approved: boolean) => { if (confirmRequest) confirmMutation.mutate({ taskId: confirmRequest.taskId, approved }); };
  const handleReplay = (taskId: number) => { setReplayTaskId(taskId); };

  const handleBack = () => {
    if (historyIdx > 0) {
      const newIdx = historyIdx - 1;
      setHistoryIdx(newIdx);
      const url = browsingHistory[newIdx];
      setCommandValue("");
      setTargetUrl(url);
      handleManualAction("navigate", { url });
    }
  };
  const handleForward = () => {
    if (historyIdx < browsingHistory.length - 1) {
      const newIdx = historyIdx + 1;
      setHistoryIdx(newIdx);
      const url = browsingHistory[newIdx];
      setCommandValue("");
      setTargetUrl(url);
      handleManualAction("navigate", { url });
    }
  };

  const settings = settingsQuery.data;
  const safetyMode = settings?.safetyMode || "readonly";
  const safetyConfig = SAFETY_MODES[safetyMode] || SAFETY_MODES.readonly;
  const SafetyIcon = safetyConfig.icon;

  const allTasks = tasksQuery.data || [];
  const sessionTasks = allTasks.filter(t => t.sessionId === activeSession);
  const queuedCount = allTasks.filter(t => t.status === "queued").length;
  const runningCount = allTasks.filter(t => t.status === "running").length;

  const tabs = tabsQuery.data || [];
  const phaseConfig = PHASE_CONFIG[currentPhase] || PHASE_CONFIG.idle;
  const PhaseIcon = phaseConfig.icon;

  return (
    <div className="h-screen flex flex-col bg-background select-none" data-testid="control-center">

      {/* ═══════════════════════════════════════════════════════════════════════════
          BROWSER TAB BAR (minimal)
          ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="h-9 bg-card/60 border-b border-border flex items-center px-2 gap-0.5 shrink-0" data-testid="tab-bar">
        {/* Window controls aesthetic */}
        <div className="flex gap-1.5 px-2 shrink-0">
          <div className="w-3 h-3 rounded-full bg-red-500/60 hover:bg-red-500 transition-colors" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/60 hover:bg-yellow-500 transition-colors" />
          <div className="w-3 h-3 rounded-full bg-green-500/60 hover:bg-green-500 transition-colors" />
        </div>

        {/* Tabs */}
        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto px-1 min-w-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabSwitch(tab.id)}
              className={`flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-t-md text-[11px] transition-all shrink-0 max-w-[160px] group ${
                activeTabId === tab.id
                  ? "bg-background text-foreground font-medium border-t border-l border-r border-border -mb-px"
                  : "hover:bg-accent/40 text-muted-foreground"
              }`}
              data-testid={`button-tab-${tab.id}`}
            >
              <Globe className="h-3 w-3 shrink-0 opacity-50" />
              <span className="truncate">{tab.label || tab.url || "New Tab"}</span>
            </button>
          ))}
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCreateTab} data-testid="button-new-tab">
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {/* Status + theme toggle */}
        <div className="flex items-center gap-2 pl-2 shrink-0">
          {/* Back to Code workspace — primary mode */}
          <Link href="/">
            <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1 border-primary/30 text-primary hover:bg-primary/10" data-testid="button-nav-code">
              <Code2 className="h-3 w-3" />
              ⚡ Code
            </Button>
          </Link>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${healthQuery.data?.status === "ok" ? "bg-emerald-500 status-pulse" : "bg-red-500"}`} />
            <span className="text-[9px] text-muted-foreground">SRV</span>
          </div>
          {(queuedCount > 0 || runningCount > 0) && (
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              {runningCount > 0 && `${runningCount} active`}
              {runningCount > 0 && queuedCount > 0 && " · "}
              {queuedCount > 0 && `${queuedCount} queued`}
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleTheme} data-testid="button-theme-toggle">
            {theme === "dark" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
          </Button>
          <Link href="/kwork">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1 text-primary hover:text-primary" data-testid="button-nav-kwork">
              <TrendingUp className="h-3 w-3" />
              Kwork
            </Button>
          </Link>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════
          PROVIDER CONNECTION STATUS BANNER
          Visible always — prominent when not connected, compact when OK.
          ═══════════════════════════════════════════════════════════════════════════ */}
      {providerStatus.checked && (
        <div
          className={`shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs border-b transition-colors ${
            providerStatus.ok
              ? "bg-emerald-500/5 border-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/8 border-amber-500/20 text-amber-600 dark:text-amber-400"
          }`}
          data-testid="provider-status-banner"
        >
          {providerStatus.ok ? (
            <>
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              <span className="font-medium">
                {settingsQuery.data?.providerType
                  ? settingsQuery.data.providerType === "ollama" ? "Ollama"
                  : settingsQuery.data.providerType === "lmstudio" ? "LM Studio"
                  : settingsQuery.data.providerType
                  : "Провайдер"} подключён
              </span>
              {settingsQuery.data?.model && (
                <span className="font-mono text-[10px] text-muted-foreground ml-1">
                  · {settingsQuery.data.model}
                </span>
              )}
              <Link href="/settings" className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" data-testid="link-change-provider">
                Изменить
              </Link>
            </>
          ) : (
            <>
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="font-medium">Провайдер недоступен — деградированный режим</span>
              {settingsQuery.data?.model && (
                <span className="text-[10px] text-muted-foreground/70">
                  (настроен: {settingsQuery.data.model})
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => checkMutation.mutate()}
                  disabled={checkMutation.isPending}
                  className="text-[10px] text-amber-500 hover:text-amber-400 transition-colors underline underline-offset-2 disabled:opacity-50"
                  data-testid="button-recheck-provider"
                >
                  {checkMutation.isPending ? "Проверка…" : "Повторить"}
                </button>
                <Link href="/settings" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" data-testid="link-open-provider-settings">
                  Настройки
                </Link>
              </div>
            </>
          )}
        </div>
      )}
      {/* Checking state — minimal pulse */}
      {providerStatus.checking && !providerStatus.checked && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border bg-card/20" data-testid="provider-status-checking">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
          <span className="text-muted-foreground/60">Проверка подключения…</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
          COMMAND BAR — the single main input (Computer-first)
          ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="min-h-[48px] border-b border-border flex items-center gap-2 px-3 py-1.5 shrink-0 bg-card/30" data-testid="command-bar">
        {/* Nav buttons */}
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleBack} disabled={historyIdx <= 0} data-testid="button-back">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleForward} disabled={historyIdx >= browsingHistory.length - 1} data-testid="button-forward">
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefreshPreview} disabled={previewLoading} data-testid="button-reload">
            <RefreshCw className={`h-3.5 w-3.5 ${previewLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Main Command Input */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 h-9 bg-muted/40 hover:bg-muted/60 focus-within:bg-muted/70 focus-within:ring-1 focus-within:ring-primary/30 rounded-lg px-3 transition-all" data-testid="command-input-wrapper">
            {isRunning || computerRunMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
            ) : actionExecuting ? (
              <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />
            ) : providerStatus.checking ? (
              <Loader2 className="h-3.5 w-3.5 text-muted-foreground/40 animate-spin shrink-0" />
            ) : providerStatus.checked && !providerStatus.ok ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400/70 shrink-0" aria-label="Провайдер недоступен — деградированный режим" />
            ) : (
              <CommandIcon className="h-3.5 w-3.5 text-primary/60 shrink-0" />
            )}
            <input
              ref={commandInputRef}
              type="text"
              value={commandValue}
              onChange={e => {
                const v = e.target.value;
                setCommandValue(v);
                if (v.trim().length > 2) {
                  // Code intent takes priority in hint display
                  if (isCodeIntent(v.trim())) {
                    const intent = parseIntent(v.trim());
                    const lang = intent.codeLanguage || "code";
                    setCommandHint(`→ выполнить локально [${lang}]`);
                  } else {
                    const intent = parseIntent(v.trim());
                    if (intent.url && (intent.type === "open_site" || intent.type === "navigate_url" || intent.type === "search")) {
                      setCommandHint(`→ ${intent.url}`);
                    } else {
                      setCommandHint(null);
                    }
                  }
                } else {
                  setCommandHint(null);
                }
              }}
              onKeyDown={e => { if (e.key === "Enter") handleCommandSubmit(); }}
              placeholder="Напишите команду: «открой google», «найди в google …», или любую задачу"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40"
              data-testid="input-command"
            />
            {commandValue && (
              <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setCommandValue("")}>
                <X className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-primary hover:text-primary"
              onClick={handleCommandSubmit}
              disabled={!commandValue.trim() || isRunning || computerRunMutation.isPending}
              data-testid="button-command-submit"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
          {/* Inline hints row */}
          {(commandHint || (providerStatus.checked && !providerStatus.ok && !providerStatus.checking)) && (
            <div className="flex items-center gap-3 px-3 mt-0.5">
              {commandHint && (
                <span className="text-[10px] text-muted-foreground/50 font-mono truncate">{commandHint}</span>
              )}
              {providerStatus.checked && !providerStatus.ok && !providerStatus.checking && (
                <span className="text-[10px] text-amber-400/70 ml-auto shrink-0" data-testid="provider-offline-hint">Деградированный режим — LLM недоступен</span>
              )}
            </div>
          )}
        </div>

        {/* Code IDE shortcut */}
        <Link href="/code">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs px-3 text-primary border-primary/30 hover:bg-primary/10"
            data-testid="button-open-code-ide"
            title="Открыть Code IDE — редактор + preview + sandbox"
          >
            <Code2 className="h-3.5 w-3.5" />
            Code IDE
          </Button>
        </Link>

        {/* Sidecar toggle */}
        <Button
          variant={sidecarOpen ? "default" : "outline"}
          size="sm"
          className="h-8 gap-1.5 text-xs px-3"
          onClick={() => setSidecarOpen(!sidecarOpen)}
          data-testid="button-toggle-sidecar"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Computer
        </Button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════
          MAIN CONTENT: Browser Viewport + Sidecar
          ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex min-h-0">

        {/* ── Browser Viewport ── */}
        <main className="flex-1 flex flex-col min-w-0 bg-background" data-testid="browser-viewport">
          {previewSync?.hasScreenshot ? (
            <div className="flex-1 relative overflow-hidden bg-neutral-900/20">
              <img
                key={previewSync.syncId}
                src={`/api/preview/screenshot?sessionId=${activeSession}&t=${previewSync.syncId}`}
                alt="Browser Preview"
                className="w-full h-full object-contain"
                data-testid="img-preview-screenshot"
              />
              {previewLoading && (
                <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              )}
              {/* Floating phase indicator */}
              {isRunning && (
                <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg">
                  <PhaseIcon className={`h-3.5 w-3.5 ${phaseConfig.color} ${!["idle", "completed", "error"].includes(currentPhase) ? "animate-pulse" : ""}`} />
                  <span className={`text-[11px] font-bold ${phaseConfig.color}`}>{phaseConfig.label}</span>
                  {currentMaxSteps > 0 && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">{currentStep}/{currentMaxSteps}</Badge>
                  )}
                </div>
              )}
              {/* URL bar inside viewport */}
              {previewSync?.url && (
                <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg">
                  <Globe className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  <span className="text-[10px] font-mono text-muted-foreground truncate">{previewSync.url}</span>
                </div>
              )}
            </div>
          ) : (
            /* ── Main Functions Hero — two explicit entry points ── */
            <div className="flex-1 flex flex-col items-center justify-start pt-10 pb-8 px-4 overflow-y-auto">
              {/* Header */}
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
                  <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-label="Local Comet" className="text-primary">
                    <circle cx="16" cy="16" r="6" stroke="currentColor" strokeWidth="2" />
                    <path d="M16 4 L18 10 L16 8 L14 10 Z" fill="currentColor" opacity="0.7" />
                    <path d="M4 16 L10 14 L8 16 L10 18 Z" fill="currentColor" opacity="0.5" />
                    <path d="M28 16 L22 18 L24 16 L22 14 Z" fill="currentColor" opacity="0.5" />
                    <path d="M16 28 L14 22 L16 24 L18 22 Z" fill="currentColor" opacity="0.7" />
                    <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.3" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-base font-bold leading-tight">Local Comet</h1>
                  <p className="text-[11px] text-muted-foreground">Выберите функцию и введите запрос</p>
                </div>
              </div>

              {/* Provider status */}
              <div className="w-full max-w-2xl mb-6">
                <ProviderConnectBlock />
              </div>

              {/* ══ TWO MAIN FUNCTION PANELS ══ */}
              <div className="w-full max-w-2xl grid grid-cols-2 gap-4 mb-8" data-testid="main-functions-grid">

                {/* ── Panel 1: Code Generator ── */}
                <div
                  className="flex flex-col rounded-xl border-2 border-primary/25 bg-card/60 hover:border-primary/50 transition-colors overflow-hidden"
                  data-testid="panel-code-generator"
                >
                  {/* Panel header */}
                  <div className="flex items-center gap-2.5 px-4 py-3 bg-primary/5 border-b border-primary/15">
                    <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                      <Code2 className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-bold leading-tight">Генератор кода</div>
                      <div className="text-[10px] text-muted-foreground">Текст → рабочий код</div>
                    </div>
                  </div>

                  {/* Panel body */}
                  <div className="flex-1 flex flex-col p-4 gap-3">
                    <Textarea
                      placeholder="Опиши код, игру, приложение или сайт, который нужно создать…"
                      value={codeQuery}
                      onChange={e => setCodeQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCodeSubmit(); }}
                      className="min-h-[90px] text-xs resize-none bg-background/60"
                      rows={4}
                      data-testid="input-code-query"
                    />
                    <Button
                      onClick={handleCodeSubmit}
                      disabled={!codeQuery.trim()}
                      className="w-full gap-2 font-semibold"
                      data-testid="button-generate-code"
                    >
                      <Code2 className="h-4 w-4" />
                      Сгенерировать код
                    </Button>
                    {/* Code examples */}
                    <div className="space-y-1">
                      <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Примеры</p>
                      {[
                        { text: "напиши игру змейку", icon: "🎮" },
                        { text: "сделай калькулятор", icon: "📱" },
                        { text: "создай телеграм бота", icon: "🤖" },
                      ].map((ex, i) => (
                        <button
                          key={i}
                          onClick={() => { setCodeQuery(ex.text); }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-primary/8 transition-colors text-left group"
                          data-testid={`button-code-example-${i}`}
                        >
                          <span className="text-sm opacity-60">{ex.icon}</span>
                          <span className="text-[10px] font-mono text-muted-foreground group-hover:text-primary transition-colors">{ex.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Panel 2: Browser Agent ── */}
                <div
                  className="flex flex-col rounded-xl border-2 border-blue-500/25 bg-card/60 hover:border-blue-500/50 transition-colors overflow-hidden"
                  data-testid="panel-browser-agent"
                >
                  {/* Panel header */}
                  <div className="flex items-center gap-2.5 px-4 py-3 bg-blue-500/5 border-b border-blue-500/15">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
                      <Bot className="h-4 w-4 text-blue-400" />
                    </div>
                    <div>
                      <div className="text-sm font-bold leading-tight">Браузерный агент</div>
                      <div className="text-[10px] text-muted-foreground">Автономные задачи в браузере</div>
                    </div>
                  </div>

                  {/* Panel body */}
                  <div className="flex-1 flex flex-col p-4 gap-3">
                    <Textarea
                      placeholder="Опиши задачу для браузерного агента… например: найди в google последние новости об AI"
                      value={agentQuery}
                      onChange={e => setAgentQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAgentSubmit(); }}
                      className="min-h-[90px] text-xs resize-none bg-background/60"
                      rows={4}
                      data-testid="input-agent-query"
                    />
                    <Button
                      onClick={handleAgentSubmit}
                      disabled={!agentQuery.trim() || computerRunMutation.isPending}
                      className="w-full gap-2 font-semibold bg-blue-600 hover:bg-blue-700 text-white border-0"
                      data-testid="button-run-agent-hero"
                    >
                      {computerRunMutation.isPending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Bot className="h-4 w-4" />
                      }
                      Запустить агента
                    </Button>
                    {/* Agent examples */}
                    <div className="space-y-1">
                      <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider">Примеры</p>
                      {[
                        { text: "открой github и найди trending repos", icon: "🌐" },
                        { text: "найди в google нейросети 2026", icon: "🔍" },
                        { text: "открой сайт habr.com", icon: "📰" },
                      ].map((ex, i) => (
                        <button
                          key={i}
                          onClick={() => { setAgentQuery(ex.text); }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-blue-500/8 transition-colors text-left group"
                          data-testid={`button-agent-example-${i}`}
                        >
                          <span className="text-sm opacity-60">{ex.icon}</span>
                          <span className="text-[10px] font-mono text-muted-foreground group-hover:text-blue-400 transition-colors">{ex.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tip line */}
              <p className="text-[10px] text-muted-foreground/30 text-center">
                Ctrl+Enter для отправки · Команды без роутинга: напишите задачу и нажмите нужную кнопку
              </p>
            </div>
          )}
        </main>

        {/* ═══════════════════════════════════════════════════════════════════════════
            RIGHT SIDECAR: Computer Panel (primary)
            ═══════════════════════════════════════════════════════════════════════════ */}
        {sidecarOpen && (
          <aside className="w-[340px] border-l border-border flex flex-col shrink-0 bg-card/30" data-testid="sidecar-panel">

            {/* Sidecar Header */}
            <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card/50">
              <MonitorSmartphone className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-bold">Computer</span>
              <div className="flex-1" />
              {isHostedPreview() ? (
                <Badge variant="outline" className="gap-1 text-[9px] text-blue-400 border-blue-500/30 bg-blue-500/5" data-testid="badge-preview-mode">Preview</Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-[9px] text-emerald-500 border-emerald-500/30 bg-emerald-500/5" data-testid="badge-local-mode">Local</Badge>
              )}
              <Badge variant="outline" className={`gap-1 text-[9px] ${safetyConfig.color}`}>
                <SafetyIcon className="h-2.5 w-2.5" /> {safetyConfig.label}
              </Badge>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSidecarOpen(false)}>
                <PanelRightClose className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Mode Tabs: primary = Agent / Chat; secondary = Terminal / Code (advanced tools) */}
            <div className="flex border-b border-border shrink-0" data-testid="sidecar-modes">
              {([
                { id: "computer" as SidecarMode, label: "Agent", icon: MonitorSmartphone },
                { id: "chat" as SidecarMode, label: "Chat", icon: MessageSquare },
                { id: "research" as SidecarMode, label: "Research", icon: BookOpen },
              ]).map(mode => (
                <button
                  key={mode.id}
                  onClick={() => { setSidecarMode(mode.id); setShowAdvancedTools(false); }}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-medium transition-all border-b-2 shrink-0 ${
                    sidecarMode === mode.id && !showAdvancedTools
                      ? "text-primary border-primary"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:border-muted"
                  }`}
                  data-testid={`button-mode-${mode.id}`}
                >
                  <mode.icon className="h-3 w-3" />
                  {mode.label}
                </button>
              ))}
              {/* Advanced tools toggle (Terminal / Code) */}
              <button
                onClick={() => setShowAdvancedTools(v => !v)}
                className={`flex items-center justify-center gap-1 py-2 px-2.5 text-[10px] font-medium transition-all border-b-2 shrink-0 ${
                  showAdvancedTools
                    ? "text-amber-400 border-amber-400"
                    : "text-muted-foreground/50 border-transparent hover:text-muted-foreground hover:border-muted"
                }`}
                data-testid="button-mode-advanced"
                title="Terminal и Code Sandbox"
              >
                <MoreHorizontal className="h-3 w-3" />
              </button>
            </div>
            {/* Advanced tools sub-tabs (only when expanded) */}
            {showAdvancedTools && (
              <div className="flex border-b border-border bg-muted/20 shrink-0" data-testid="advanced-tools-tabs">
                {([
                  { id: "terminal" as SidecarMode, label: "Terminal", icon: Server },
                  { id: "sandbox" as SidecarMode, label: "Code", icon: Cpu },
                ]).map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => setSidecarMode(mode.id)}
                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-all border-b-2 shrink-0 ${
                      sidecarMode === mode.id
                        ? "text-amber-400 border-amber-400"
                        : "text-muted-foreground/60 border-transparent hover:text-foreground hover:border-muted"
                    }`}
                    data-testid={`button-mode-${mode.id}`}
                  >
                    <mode.icon className="h-3 w-3" />
                    {mode.label}
                  </button>
                ))}
              </div>
            )}

            {/* Sidecar Content */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

              {/* === COMPUTER MODE (default) — autonomous mission view === */}
              {sidecarMode === "computer" && (
                <div className="flex-1 flex flex-col min-h-0">

                  {/* ── Degraded mode banner (no LLM) ── */}
                  {providerStatus.checked && !providerStatus.ok && !isRunning && (
                    <div className="px-3 py-2 border-b border-amber-500/20 bg-amber-500/5 flex items-start gap-2 shrink-0" data-testid="degraded-mode-banner">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-[10px] text-amber-400/90 leading-relaxed">
                        <span className="font-semibold">Деградированный режим</span>{" "}— провайдер недоступен.{" "}
                        Задачи будут выполняться без LLM по шаблонному плану.{" "}
                        <Link href="/settings"><span className="underline cursor-pointer hover:text-amber-300">Настройки провайдера</span></Link>
                      </div>
                    </div>
                  )}

                  {/* ── Active Mission Card ── */}
                  {activeMission ? (
                    <div className="border-b border-border">
                      <MissionCard
                        mission={activeMission}
                        onClear={() => setActiveMission(null)}
                      />
                    </div>
                  ) : !isRunning && liveEvents.length === 0 ? (
                    /* Empty state */
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/30 px-4 text-center">
                      <MonitorSmartphone className="h-8 w-8 mb-3 opacity-20" />
                      <p className="text-[11px] font-medium">Напишите задачу</p>
                      <p className="text-[10px] mt-1 max-w-[200px]">
                        Computer сам построит план и выполнит. Например: «открой grok», «найди в google …»
                      </p>
                    </div>
                  ) : null}

                  {/* ── What the agent currently sees ── */}
                  {lastSnapshot && (
                    <div className="px-3 py-2 border-b border-border shrink-0">
                      <div className="text-[9px] text-muted-foreground/40 uppercase tracking-wider mb-1">Страница</div>
                      <div className="text-[11px] font-medium truncate">{lastSnapshot.title || "Без заголовка"}</div>
                      <div className="text-[10px] font-mono text-muted-foreground truncate">{lastSnapshot.url}</div>
                      <div className="flex gap-3 mt-1 text-[10px]">
                        <span className="text-blue-400">{lastSnapshot.stats.links} ссыл</span>
                        <span className="text-amber-400">{lastSnapshot.stats.buttons} кн</span>
                        <span className="text-green-400">{lastSnapshot.stats.inputs} поле</span>
                        <span className="text-purple-400">{lastSnapshot.stats.headings} заг</span>
                      </div>
                    </div>
                  )}

                  {/* ── Live event log (secondary, collapsed by default if mission visible) ── */}
                  {liveEvents.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-3 py-1 border-b border-border/30 shrink-0">
                        <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wider flex-1">Живой лог ({liveEvents.length})</span>
                        <button
                          onClick={() => setLiveEvents([])}
                          className="text-[9px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
                          data-testid="button-clear-log"
                        >
                          очистить
                        </button>
                      </div>
                      <ScrollArea className="flex-1">
                        <div className="p-2 space-y-0">
                          {liveEvents.map((event, i) => <LiveLogEntry key={i} event={event} />)}
                          <div ref={sidecarLogRef} />
                        </div>
                      </ScrollArea>
                    </>
                  )}
                </div>
              )}

              {/* === CHAT MODE === */}
              {sidecarMode === "chat" && (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Task input area (secondary — for manual URL+goal) */}
                  <div className="p-3 border-b border-border space-y-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground/50 block mb-0.5">Цель / задача</label>
                      <Textarea
                        placeholder="Что нужно сделать? (или напишите в командную строку выше)"
                        value={goalText}
                        onChange={e => setGoalText(e.target.value)}
                        className="min-h-[48px] text-xs resize-none"
                        rows={2}
                        data-testid="input-goal-text"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground/40 block mb-0.5">Стартовый URL (необязательно)</label>
                      <Input
                        placeholder="https://... — оставьте пустым для авторешения"
                        value={targetUrl}
                        onChange={e => setTargetUrl(e.target.value)}
                        className="h-7 text-[11px] font-mono text-muted-foreground"
                        data-testid="input-target-url"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        onClick={() => {
                          if (!goalText) { toast({ title: "Заполните задачу", variant: "destructive" }); return; }
                          const url = targetUrl || "https://www.google.com";
                          runMutation.mutate({ url, goal: goalText, maxSteps, sessionId: activeSession, workspaceId: activeWorkspaceId });
                        }}
                        disabled={runMutation.isPending || !goalText}
                        className="flex-1 h-8 gap-1.5 text-xs"
                        data-testid="button-run-agent"
                      >
                        {runMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        Запуск
                      </Button>
                      <div className="flex items-center gap-1 bg-muted/30 rounded-md px-2">
                        <Hash className="h-2.5 w-2.5 text-muted-foreground/40" />
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          value={maxSteps}
                          onChange={e => setMaxSteps(parseInt(e.target.value) || 10)}
                          className="h-7 w-10 text-[10px] text-center font-mono border-0 bg-transparent p-0"
                          title="Лимит шагов"
                          data-testid="input-max-steps"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Chat event history */}
                  <ScrollArea className="flex-1">
                    <div className="p-2 space-y-0">
                      {liveEvents.length === 0 && !isRunning && (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/30">
                          <MessageSquare className="h-8 w-8 mb-3 opacity-30" />
                          <p className="text-[11px] font-medium">Начните диалог</p>
                          <p className="text-[10px] mt-1">Введите задачу и нажмите «Запуск»</p>
                        </div>
                      )}
                      {liveEvents.map((event, i) => (
                        <LiveLogEntry key={i} event={event} />
                      ))}
                      <div ref={sidecarLogRef} />
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* === RESEARCH MODE === */}
              {sidecarMode === "research" && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="p-3 space-y-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground/50 block mb-0.5">Тема исследования</label>
                      <Textarea
                        placeholder="Что исследовать? Агент проанализирует несколько источников"
                        value={goalText}
                        onChange={e => setGoalText(e.target.value)}
                        className="min-h-[60px] text-xs resize-none"
                        rows={3}
                        data-testid="input-research-query"
                      />
                    </div>
                    <Button
                      onClick={() => {
                        if (goalText) {
                          const url = targetUrl || "https://www.google.com";
                          runMutation.mutate({ url, goal: `Исследовать: ${goalText}`, maxSteps: 15, sessionId: activeSession, workspaceId: activeWorkspaceId });
                        }
                      }}
                      disabled={runMutation.isPending || !goalText}
                      className="w-full h-8 gap-1.5 text-xs"
                      data-testid="button-research-start"
                    >
                      {runMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                      Начать исследование
                    </Button>
                  </div>

                  <ScrollArea className="flex-1">
                    <div className="p-2 space-y-0">
                      {liveEvents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/30">
                          <BookOpen className="h-8 w-8 mb-3 opacity-30" />
                          <p className="text-[11px] font-medium">Режим исследования</p>
                          <p className="text-[10px] mt-1">Агент проанализирует несколько источников</p>
                        </div>
                      ) : (
                        liveEvents.map((event, i) => <LiveLogEntry key={i} event={event} />)
                      )}
                      <div ref={sidecarLogRef} />
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* === TERMINAL MODE === */}
              {sidecarMode === "terminal" && (
                <TerminalPanel sessionId={activeSession} />
              )}

              {/* === CODE SANDBOX MODE === */}
              {sidecarMode === "sandbox" && (
                <SandboxPanel sessionId={activeSession} injection={sandboxInjection} />
              )}
            </div>

            {/* ── Model Settings (collapsed by default) ── */}
            <ModelSettingsCollapsible />

            {/* ── Secondary Actions (collapsed) ── */}
            <div className="border-t border-border/50 shrink-0">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/20 transition-colors text-[11px] text-muted-foreground"
                data-testid="button-toggle-advanced"
              >
                <MoreHorizontal className="h-3 w-3" />
                <span>Доп. инструменты</span>
                <div className="flex-1" />
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showAdvanced && (
                <div className="px-3 pb-3 space-y-1.5">
                  {/* Queue overview */}
                  <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Очередь и история</div>
                  {sessionTasks.length === 0 && allTasks.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/40 py-1">Пусто</p>
                  ) : (
                    <div className="max-h-28 overflow-auto space-y-0.5">
                      {(sessionTasks.length > 0 ? sessionTasks : allTasks.slice(0, 5)).map(task => {
                        const sc = STATUS_CONFIG[task.status] || STATUS_CONFIG.queued;
                        const SI = sc.icon;
                        return (
                          <div
                            key={task.id}
                            onClick={() => handleReplay(task.id)}
                            className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer hover:bg-accent/40 transition-colors"
                            data-testid={`card-task-${task.id}`}
                          >
                            <SI className={`h-3 w-3 ${sc.color} ${task.status === "running" ? "animate-spin" : ""} shrink-0`} />
                            <span className="text-[10px] font-medium truncate flex-1">{task.title}</span>
                            <Badge variant="outline" className={`text-[8px] px-1 py-0 ${sc.color}`}>{sc.label}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Workspace / Session info */}
                  <div className="flex gap-2 text-[10px] pt-1">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Briefcase className="h-2.5 w-2.5" />
                      <span>{(workspacesQuery.data || []).find(w => w.id === activeWorkspaceId)?.name || "Default"}</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <CircleDot className="h-2.5 w-2.5" />
                      <span className="font-mono">{activeSession.length > 15 ? activeSession.slice(0, 15) + "…" : activeSession}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1.5 flex-wrap">
                    {showWorkspaceInput ? (
                      <div className="flex gap-1 flex-1">
                        <Input
                          autoFocus
                          value={newWorkspaceName}
                          onChange={e => setNewWorkspaceName(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") handleWorkspaceSubmit(); if (e.key === "Escape") { setShowWorkspaceInput(false); setNewWorkspaceName(""); } }}
                          placeholder="Имя workspace…"
                          className="h-6 text-[10px] flex-1"
                          data-testid="input-workspace-name"
                        />
                        <Button size="sm" className="h-6 text-[9px] px-2" onClick={handleWorkspaceSubmit} disabled={!newWorkspaceName.trim() || createWorkspaceMutation.isPending}>
                          {createWorkspaceMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] px-1" onClick={() => { setShowWorkspaceInput(false); setNewWorkspaceName(""); }}>
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1" onClick={handleCreateWorkspace} data-testid="button-new-workspace">
                        <Plus className="h-2.5 w-2.5" /> Workspace
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1" onClick={handleCreateSession} data-testid="button-new-session">
                      <Plus className="h-2.5 w-2.5" /> Сессия
                    </Button>
                    <Button variant="outline" size="sm" className="h-6 text-[9px] gap-1" onClick={handleExportSession} data-testid="button-export-session">
                      <Download className="h-2.5 w-2.5" /> Экспорт
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Replay Drawer (overlay) ── */}
      {replayTaskId && (
        <ReplayDrawer taskId={replayTaskId} onClose={() => setReplayTaskId(null)} />
      )}

      {/* ── Risk Card Confirm Dialog ── */}
      {confirmRequest && (
        <RiskCard
          confirmReq={confirmRequest}
          onConfirm={() => handleConfirm(true)}
          onDeny={() => handleConfirm(false)}
          isPending={confirmMutation.isPending}
        />
      )}
    </div>
  );
}
