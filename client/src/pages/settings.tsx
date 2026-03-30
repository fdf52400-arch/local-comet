import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Save, Zap, CheckCircle2, XCircle, Loader2,
  RefreshCw, MessageSquare, ShieldCheck, ShieldAlert, Shield,
  AlertCircle, Info, Server, Terminal, Cloud, KeyRound, Eye, EyeOff,
  ExternalLink, AlertTriangle,
} from "lucide-react";
import { Link } from "wouter";
import { LOCAL_PROVIDERS, CLOUD_PROVIDERS, type ProviderType } from "@shared/schema";
import { isHostedPreview, localProviderHostedNote } from "@/lib/hosting-env";

// ─── Provider definitions ─────────────────────────────────────────────────────

interface ProviderDef {
  id: ProviderType;
  label: string;
  icon: any;
  description: string;
  defaultBaseUrl: string;
  defaultPort: number | null;
  hasPort: boolean;
  hasApiKey: boolean;
  hasBaseUrl: boolean;
  modelPlaceholder: string;
  category: "local" | "cloud";
  setupCmd?: string;
  keyDocsUrl?: string;
  supportsModelList: boolean;
  modelListNote?: string;
}

const PROVIDER_DEFS: ProviderDef[] = [
  {
    id: "ollama",
    label: "Ollama",
    icon: Server,
    description: "Открытый источник, быстрый старт, работает локально",
    defaultBaseUrl: "http://localhost",
    defaultPort: 11434,
    hasPort: true,
    hasApiKey: false,
    hasBaseUrl: true,
    modelPlaceholder: "llama3.2, mistral, gemma2…",
    category: "local",
    setupCmd: "ollama serve",
    supportsModelList: true,
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    icon: Terminal,
    description: "GUI + OpenAI-совместимый API, работает локально",
    defaultBaseUrl: "http://localhost",
    defaultPort: 1234,
    hasPort: true,
    hasApiKey: false,
    hasBaseUrl: true,
    modelPlaceholder: "local-model",
    category: "local",
    setupCmd: "LM Studio → Developer tab → Start Server",
    supportsModelList: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: Cloud,
    description: "GPT-4, GPT-4o, o1 — через официальный API OpenAI",
    defaultBaseUrl: "https://api.openai.com",
    defaultPort: null,
    hasPort: false,
    hasApiKey: true,
    hasBaseUrl: false,
    modelPlaceholder: "gpt-4o, gpt-4-turbo, gpt-3.5-turbo…",
    category: "cloud",
    keyDocsUrl: "https://platform.openai.com/api-keys",
    supportsModelList: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    icon: Cloud,
    description: "Claude 3.5, Claude 3 Haiku — через официальный API Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultPort: null,
    hasPort: false,
    hasApiKey: true,
    hasBaseUrl: false,
    modelPlaceholder: "claude-3-5-sonnet-20241022, claude-3-haiku…",
    category: "cloud",
    keyDocsUrl: "https://console.anthropic.com/settings/keys",
    supportsModelList: false,
    modelListNote: "Anthropic не предоставляет публичный список моделей через API. Введите название вручную.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    icon: Cloud,
    description: "Gemini 1.5 Pro, Gemini Flash — через Google AI API",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultPort: null,
    hasPort: false,
    hasApiKey: true,
    hasBaseUrl: false,
    modelPlaceholder: "gemini-1.5-pro, gemini-1.5-flash…",
    category: "cloud",
    keyDocsUrl: "https://aistudio.google.com/app/apikey",
    supportsModelList: true,
  },
  {
    id: "openai_compatible",
    label: "OpenAI Compatible",
    icon: Cloud,
    description: "Любой сервер с OpenAI-совместимым API (vLLM, LiteLLM, Jan, …)",
    defaultBaseUrl: "http://localhost",
    defaultPort: 8080,
    hasPort: true,
    hasApiKey: true,
    hasBaseUrl: true,
    modelPlaceholder: "gpt-3.5-turbo, custom-model…",
    category: "cloud",
    supportsModelList: true,
    modelListNote: "Список моделей загружается с вашего сервера (/v1/models).",
  },
];

// ─── Hosted preview warning for local providers ───────────────────────────────
function LocalProviderHostedWarning({ providerLabel }: { providerLabel: string }) {
  if (!isHostedPreview()) return null;
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2" data-testid="local-provider-hosted-warning">
      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="text-xs text-amber-300 font-semibold">Локальный провайдер в публичном preview</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {localProviderHostedNote()}
        </p>
      </div>
    </div>
  );
}

// ─── Degraded-mode info box ───────────────────────────────────────────────────
function DegradedInfo({ providerType }: { providerType: string }) {
  const def = PROVIDER_DEFS.find(p => p.id === providerType);
  const cmd = def?.setupCmd ?? "запустите провайдер";
  const port = def?.defaultPort ?? "";
  const isLocal = LOCAL_PROVIDERS.includes(providerType as any);
  if (!isLocal) return null;
  return (
    <div className="bg-amber-500/8 border border-amber-500/25 rounded-lg p-3 space-y-1.5" data-testid="degraded-info">
      <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        Провайдер недоступен — деградированный режим
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Агент работает без LLM: план составляется автоматически по шаблону,
        ответы на chat-запросы недоступны. Для полной работы запустите{" "}
        {def?.label ?? providerType} {port ? `на порту ${port}` : ""}.
      </p>
      <div className="bg-black/30 rounded px-2 py-1 font-mono text-[11px] text-muted-foreground select-all">
        {cmd}
      </div>
      <p className="text-xs text-muted-foreground">
        После запуска нажмите «Проверить подключение».
      </p>
    </div>
  );
}

// ─── Model list component ─────────────────────────────────────────────────────
function ModelList({ models, selected, onChange }: {
  models: string[];
  selected: string;
  onChange: (v: string) => void;
}) {
  if (models.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="model-list">
      <Label className="text-xs text-foreground/80">Выберите модель ({models.length} доступно)</Label>
      <Select value={selected} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-sm" data-testid="select-model">
          <SelectValue placeholder="Выберите модель" />
        </SelectTrigger>
        <SelectContent>
          {models.map(m => (
            <SelectItem key={m} value={m} data-testid={`model-option-${m}`}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── API Key input with show/hide ──────────────────────────────────────────────
function ApiKeyInput({ value, onChange, label = "API Key", docsUrl }: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  docsUrl?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-foreground/80 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <KeyRound className="h-3 w-3" />
          {label}
        </span>
        {docsUrl && (
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Где взять ключ?
          </a>
        )}
      </Label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="sk-… или введите ключ"
          className="h-9 text-sm pr-10 font-mono"
          data-testid="input-api-key"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-toggle-api-key-visibility"
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Ключ хранится только локально в вашей базе данных приложения.
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();

  const settingsQuery = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  const [form, setForm] = useState({
    providerType: "ollama" as ProviderType,
    baseUrl: "http://localhost",
    port: 11434,
    model: "",
    apiKey: "",
    temperature: "0.7",
    maxTokens: 2048,
    safetyMode: "readonly",
  });

  const [models, setModels] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<{ok: boolean; message: string} | null>(null);
  const [autoChecked, setAutoChecked] = useState(false);
  const [autoChecking, setAutoChecking] = useState(false);

  const currentProviderDef = PROVIDER_DEFS.find(p => p.id === form.providerType) ?? PROVIDER_DEFS[0];
  const isLocalProvider = LOCAL_PROVIDERS.includes(form.providerType as any);
  const isCloudProvider = CLOUD_PROVIDERS.includes(form.providerType as any);

  useEffect(() => {
    if (settingsQuery.data && settingsQuery.data.providerType) {
      const d = settingsQuery.data;
      setForm({
        providerType: d.providerType || "ollama",
        baseUrl: d.baseUrl || "http://localhost",
        port: d.port || 11434,
        model: d.model || "",
        apiKey: d.apiKey || "",
        temperature: d.temperature || "0.7",
        maxTokens: d.maxTokens || 2048,
        safetyMode: d.safetyMode || "readonly",
      });
      // Auto-check silently on first load for local providers only (not in hosted preview)
      if (!autoChecked && LOCAL_PROVIDERS.includes(d.providerType) && !isHostedPreview()) {
        setAutoChecked(true);
        setAutoChecking(true);
        setTimeout(async () => {
          try {
            const res = await apiRequest("POST", "/api/providers/check", {
              providerType: d.providerType || "ollama",
              baseUrl: d.baseUrl || "http://localhost",
              port: d.port || 11434,
              apiKey: "",
            });
            const result = await res.json();
            setConnectionStatus(result);
            setAutoChecking(false);
            if (result.ok) {
              const mRes = await apiRequest("POST", "/api/providers/models", {
                providerType: d.providerType || "ollama",
                baseUrl: d.baseUrl || "http://localhost",
                port: d.port || 11434,
                apiKey: "",
              });
              const mData = await mRes.json();
              if (mData.models?.length > 0) setModels(mData.models);
            }
          } catch {
            setConnectionStatus({ ok: false, message: "Провайдер недоступен — нет соединения" });
            setAutoChecking(false);
          }
        }, 400);
      } else if (!autoChecked) {
        setAutoChecked(true);
      }
    }
  }, [settingsQuery.data]);

  // Auto-set default port + baseUrl when provider changes
  useEffect(() => {
    const def = PROVIDER_DEFS.find(p => p.id === form.providerType);
    if (!def) return;
    setForm(f => ({
      ...f,
      baseUrl: def.defaultBaseUrl,
      port: def.defaultPort ?? f.port,
    }));
    // Reset connection status when switching provider
    setConnectionStatus(null);
    setModels([]);
  }, [form.providerType]);

  // Check connection — works for both local AND cloud providers
  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/providers/check", {
        providerType: form.providerType,
        baseUrl: form.baseUrl,
        port: form.port,
        apiKey: form.apiKey,
        model: form.model,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setConnectionStatus(data);
      if (data.ok) {
        modelsMutation.mutate();
      }
    },
    onError: (err: Error) => {
      setConnectionStatus({ ok: false, message: `Ошибка запроса: ${err.message}` });
    },
  });

  const [manualModelFetch, setManualModelFetch] = useState(false);
  const modelsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/providers/models", {
        providerType: form.providerType,
        baseUrl: form.baseUrl,
        port: form.port,
        apiKey: form.apiKey,
        model: form.model,
      });
      return res.json();
    },
    onSuccess: (data) => {
      const list = data.models || [];
      setModels(list);
      if (list.length > 0 && !form.model) {
        setForm(f => ({ ...f, model: list[0] }));
      }
      if (data.error && manualModelFetch) {
        toast({ title: "Ошибка получения моделей", description: data.error, variant: "destructive" });
      }
      if (list.length > 0 && manualModelFetch) {
        toast({ title: `${list.length} моделей загружено`, description: list.slice(0, 3).join(", ") + (list.length > 3 ? "…" : "") });
      }
      setManualModelFetch(false);
    },
    onError: (err: Error) => {
      if (manualModelFetch) {
        toast({ title: "Не удалось загрузить модели", description: err.message, variant: "destructive" });
      }
      setManualModelFetch(false);
    },
  });

  const handleLoadModels = () => {
    setManualModelFetch(true);
    modelsMutation.mutate();
  };

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/chat/test", form);
      return res.json();
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
    onError: (err: Error) => {
      toast({ title: "Ошибка сохранения", description: err.message, variant: "destructive" });
    },
  });

  const effectiveUrl = currentProviderDef.hasPort
    ? `${form.baseUrl}:${form.port}`
    : form.baseUrl;

  const providerLabel = currentProviderDef.label;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="h-12 border-b border-border flex items-center px-4 gap-3 shrink-0">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <span className="font-semibold text-sm">Настройки провайдера</span>
        <div className="ml-auto flex items-center gap-2">
          {autoChecking && !connectionStatus && (
            <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground" data-testid="badge-checking">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Проверка…
            </Badge>
          )}
          {connectionStatus && (
            <Badge
              variant="outline"
              className={`text-[10px] gap-1 ${connectionStatus.ok ? "text-emerald-500 border-emerald-500/30" : "text-red-400 border-red-500/30"}`}
              data-testid="badge-connection-status"
            >
              {connectionStatus.ok
                ? <CheckCircle2 className="h-2.5 w-2.5" />
                : <XCircle className="h-2.5 w-2.5" />}
              {providerLabel} {connectionStatus.ok ? "подключен" : "недоступен"}
            </Badge>
          )}
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-2 text-xs"
            data-testid="button-save"
          >
            {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Сохранить
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* ── Provider type ───────────────────────────────────────────── */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-1">Провайдер модели</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Выберите, где работает ваша языковая модель
            </p>

            {/* Local providers */}
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-2 flex items-center gap-2">
                Локальные
                {isHostedPreview() && (
                  <span className="normal-case text-[10px] font-normal text-amber-400/70">— недоступны в публичном preview</span>
                )}
                {!isHostedPreview() && (
                  <span className="normal-case text-[10px] font-normal text-muted-foreground/50">— рекомендуется</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDER_DEFS.filter(p => p.category === "local").map(p => {
                  const Icon = p.icon;
                  const isSelected = form.providerType === p.id;
                  const dimmed = isHostedPreview();
                  return (
                    <button
                      key={p.id}
                      onClick={() => setForm(f => ({ ...f, providerType: p.id }))}
                      className={`p-3 rounded-lg border transition-colors text-left ${
                        isSelected
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-muted-foreground/40 hover:bg-accent/30"
                      } ${dimmed ? "opacity-60" : ""}`}
                      data-testid={`button-provider-${p.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                        <div className="text-sm font-semibold">{p.label}</div>
                        {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-primary ml-auto" />}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1.5">{p.description}</div>
                      <div className="text-[11px] text-muted-foreground/70 mt-1">
                        Порт: {p.defaultPort}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cloud / API providers */}
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-2 mt-3 flex items-center gap-2">
                Облачные API
                <span className="normal-case text-[10px] font-normal text-muted-foreground/50">
                  — проверка и чат через API ключ
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDER_DEFS.filter(p => p.category === "cloud").map(p => {
                  const Icon = p.icon;
                  const isSelected = form.providerType === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setForm(f => ({ ...f, providerType: p.id }))}
                      className={`p-3 rounded-lg border transition-colors text-left ${
                        isSelected
                          ? "border-blue-500/60 bg-blue-500/8"
                          : "border-border hover:border-muted-foreground/40 hover:bg-accent/30"
                      }`}
                      data-testid={`button-provider-${p.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${isSelected ? "text-blue-400" : "text-muted-foreground"}`} />
                        <div className="text-sm font-semibold">{p.label}</div>
                        {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-blue-400 ml-auto" />}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1.5">{p.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* ── Hosted warning for local providers ──────────────────────── */}
          {isLocalProvider && (
            <LocalProviderHostedWarning providerLabel={currentProviderDef.label} />
          )}

          {/* ── Connection / Endpoint ───────────────────────────────────── */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Подключение</h3>
            <div className="space-y-3">

              {/* Base URL (shown for providers that need it or have a custom one) */}
              {currentProviderDef.hasBaseUrl && (
                <div className={currentProviderDef.hasPort ? "grid grid-cols-3 gap-3" : ""}>
                  <div className={currentProviderDef.hasPort ? "col-span-2" : ""}>
                    <Label className="text-xs text-foreground/80">Base URL</Label>
                    <Input
                      value={form.baseUrl}
                      onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
                      className="h-9 text-sm mt-1 font-mono"
                      placeholder={currentProviderDef.defaultBaseUrl}
                      data-testid="input-base-url"
                    />
                  </div>
                  {currentProviderDef.hasPort && (
                    <div>
                      <Label className="text-xs text-foreground/80">Порт</Label>
                      <Input
                        type="number"
                        value={form.port}
                        onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 0 }))}
                        className="h-9 text-sm mt-1 font-mono text-center"
                        data-testid="input-port"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Effective URL preview */}
              {currentProviderDef.hasBaseUrl && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Info className="h-3 w-3" />
                  <span>Адрес: </span>
                  <code className="font-mono bg-muted/40 px-1.5 py-0.5 rounded text-foreground/80 text-[11px]">{effectiveUrl}</code>
                </div>
              )}

              {/* API Key */}
              {currentProviderDef.hasApiKey && (
                <ApiKeyInput
                  value={form.apiKey}
                  onChange={v => setForm(f => ({ ...f, apiKey: v }))}
                  label={`API Key для ${currentProviderDef.label}`}
                  docsUrl={currentProviderDef.keyDocsUrl}
                />
              )}

              {/* Connection check buttons — for ALL providers */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => checkMutation.mutate()}
                    disabled={checkMutation.isPending || (isCloudProvider && !form.apiKey.trim())}
                    className="gap-2 text-xs"
                    data-testid="button-check-connection"
                  >
                    {checkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    Проверить подключение
                  </Button>
                  {currentProviderDef.supportsModelList && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLoadModels}
                      disabled={modelsMutation.isPending || (isCloudProvider && !form.apiKey.trim())}
                      className="gap-2 text-xs"
                      data-testid="button-load-models"
                    >
                      {modelsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Загрузить модели
                    </Button>
                  )}
                </div>

                {isCloudProvider && !form.apiKey.trim() && (
                  <p className="text-[11px] text-muted-foreground">Введите API key для проверки подключения</p>
                )}

                {/* Connection status */}
                {connectionStatus && (
                  <div className={`text-xs flex items-start gap-2 p-2.5 rounded-md ${
                    connectionStatus.ok
                      ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                      : "text-red-400 bg-red-500/10 border border-red-500/20"
                  }`} data-testid="connection-status">
                    {connectionStatus.ok
                      ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      : <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                    <div className="space-y-0.5">
                      <div className="font-medium">{connectionStatus.message}</div>
                      {connectionStatus.ok && models.length > 0 && (
                        <div className="text-[11px] text-muted-foreground">{models.length} моделей доступно</div>
                      )}
                      {connectionStatus.ok && isCloudProvider && !currentProviderDef.supportsModelList && (
                        <div className="text-[11px] text-muted-foreground">{currentProviderDef.modelListNote}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Degraded mode info when local provider is offline */}
                {connectionStatus && !connectionStatus.ok && isLocalProvider && (
                  <DegradedInfo providerType={form.providerType} />
                )}

                {/* Hosted preview check result explanation */}
                {connectionStatus && !connectionStatus.ok && isLocalProvider && isHostedPreview() && (
                  <div className="text-[11px] text-amber-400/80 bg-amber-500/8 border border-amber-500/20 rounded-md p-2.5">
                    Это ожидаемо — публичный preview не может достучаться до вашего localhost.
                  </div>
                )}

                {/* Auto-check loading */}
                {(settingsQuery.isLoading || autoChecking) && !connectionStatus && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2" data-testid="auto-checking-indicator">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {settingsQuery.isLoading ? "Загрузка настроек..." : "Проверка подключения..."}
                  </div>
                )}
              </div>

              {/* Setup hint for local providers when no status yet */}
              {isLocalProvider && !connectionStatus && !autoChecking && currentProviderDef.setupCmd && (
                <div className="text-[11px] text-muted-foreground/70 bg-muted/20 rounded-md p-2.5 space-y-1">
                  <div className="font-medium text-muted-foreground">Запустите {currentProviderDef.label}:</div>
                  <code className="font-mono text-[11px] text-foreground/60 block">{currentProviderDef.setupCmd}</code>
                </div>
              )}
            </div>
          </Card>

          {/* ── Model ───────────────────────────────────────────────────── */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Модель</h3>
            <div className="space-y-3">
              {models.length > 0 ? (
                <ModelList models={models} selected={form.model} onChange={v => setForm(f => ({ ...f, model: v }))} />
              ) : (
                <div>
                  <Label className="text-xs text-foreground/80">Название модели</Label>
                  <Input
                    value={form.model}
                    onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                    placeholder={currentProviderDef.modelPlaceholder}
                    className="h-9 text-sm mt-1 font-mono"
                    data-testid="input-model-name"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {isLocalProvider
                      ? "Нажмите «Загрузить модели» для автоопределения или введите вручную"
                      : currentProviderDef.supportsModelList
                        ? "Нажмите «Загрузить модели» после проверки ключа, или введите вручную"
                        : currentProviderDef.modelListNote ?? "Введите точное название модели из документации провайдера"
                    }
                  </p>
                </div>
              )}

              <div>
                <Label className="text-xs text-foreground/80">Temperature: <span className="font-mono text-foreground">{form.temperature}</span></Label>
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  value={[parseFloat(form.temperature)]}
                  onValueChange={([v]) => setForm(f => ({ ...f, temperature: v.toFixed(1) }))}
                  className="mt-2"
                  data-testid="slider-temperature"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  0 = детерминированный · 1 = сбалансированный · 2 = максимальная случайность
                </p>
              </div>

              <div>
                <Label className="text-xs text-foreground/80">Max tokens</Label>
                <Input
                  type="number"
                  value={form.maxTokens}
                  onChange={e => setForm(f => ({ ...f, maxTokens: parseInt(e.target.value) || 2048 }))}
                  className="h-9 text-sm mt-1"
                  data-testid="input-max-tokens"
                />
              </div>

              {form.model && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || (isCloudProvider && !form.apiKey.trim())}
                  className="gap-2 text-xs"
                  data-testid="button-test-chat"
                >
                  {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
                  Тестовый запрос
                </Button>
              )}
              {testMutation.data && (
                <div className={`text-xs p-2.5 rounded-md ${testMutation.data.ok ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-red-400 bg-red-500/10 border border-red-500/20"}`} data-testid="test-result">
                  {testMutation.data.ok
                    ? `✓ Ответ (${testMutation.data.response?.model || ""}): ${testMutation.data.response?.content?.slice(0, 300)}`
                    : `✗ ${testMutation.data.error}`
                  }
                </div>
              )}
            </div>
          </Card>

          {/* ── Safety mode ─────────────────────────────────────────────── */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-1">Режим безопасности</h3>
            <p className="text-xs text-muted-foreground mb-3">Управляет тем, что агент может делать без вашего подтверждения</p>
            <div className="space-y-2">
              {[
                { id: "readonly", icon: ShieldCheck, label: "Только чтение", desc: "Агент читает страницы без записи. Рекомендуется для тестов.", color: "text-emerald-500" },
                { id: "confirm", icon: ShieldAlert, label: "Подтверждение", desc: "Агент спрашивает разрешение перед каждым действием.", color: "text-orange-400" },
                { id: "full", icon: Shield, label: "Полный доступ", desc: "Все действия разрешены без подтверждения. Только для доверенных задач.", color: "text-red-400" },
              ].map(({ id, icon: Icon, label, desc, color }) => (
                <button
                  key={id}
                  onClick={() => setForm(f => ({ ...f, safetyMode: id }))}
                  className={`w-full p-3 rounded-lg border transition-colors text-left flex items-start gap-3 ${
                    form.safetyMode === id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30 hover:bg-accent/20"
                  }`}
                  data-testid={`button-safety-${id}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${color}`} />
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${form.safetyMode === id ? color : "text-foreground"}`}>{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  </div>
                  {form.safetyMode === id && (
                    <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${color}`} />
                  )}
                </button>
              ))}
            </div>
          </Card>

          {/* Save button at bottom */}
          <div className="flex justify-end pb-4">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="gap-2"
              data-testid="button-save-bottom"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить настройки
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
