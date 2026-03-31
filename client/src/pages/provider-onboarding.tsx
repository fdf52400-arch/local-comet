import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Server, Terminal, KeyRound,
  CheckCircle2, XCircle, Loader2,
  Eye, EyeOff, ChevronRight, Info,
  Cloud, ArrowLeft, Zap,
} from "lucide-react";
import type { ProviderType } from "@shared/schema";
import {
  isHostedPreview,
  DEFAULT_OLLAMA_PORT, DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_LM_STUDIO_PORT, DEFAULT_LM_STUDIO_BASE_URL,
  EXAMPLE_LM_STUDIO_MODEL,
  EXAMPLE_MINIMAX_MODEL,
} from "@/lib/hosting-env";

// ─── Types ────────────────────────────────────────────────────────────────────

type OnboardingStep =
  | "choose"          // initial — pick one of 3 big options
  | "ollama"          // configure Ollama
  | "lmstudio"        // configure LM Studio
  | "apikey";         // pick cloud provider + enter key

type CloudProvider = "openai_compatible" | "openai" | "anthropic" | "gemini" | "minimax";

// ─── Cloud provider definitions ───────────────────────────────────────────────

interface CloudProviderDef {
  id: CloudProvider;
  label: string;
  description: string;
  placeholder: string;
  keyDocsUrl: string;
  supportsModelList: boolean;
  modelListNote?: string;
}

const CLOUD_PROVIDERS: CloudProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o, GPT-4-turbo, o1 — официальный API OpenAI",
    placeholder: "sk-…",
    keyDocsUrl: "https://platform.openai.com/api-keys",
    supportsModelList: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude 3.5, Claude 3 Haiku — официальный API Anthropic",
    placeholder: "sk-ant-…",
    keyDocsUrl: "https://console.anthropic.com/settings/keys",
    supportsModelList: false,
    modelListNote: "Anthropic не предоставляет публичный список моделей через API. Выберите модель вручную.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini 1.5 Pro, Gemini Flash — Google AI API",
    placeholder: "AIza…",
    keyDocsUrl: "https://aistudio.google.com/app/apikey",
    supportsModelList: true,
  },
  {
    id: "minimax",
    label: "MiniMax",
    description: "MiniMax-M2.7, MiniMax-M2.5 — облачный API MiniMax (ОАИ-совместимый)",
    placeholder: "mm-… или ваш MiniMax API key",
    keyDocsUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    supportsModelList: true,
    modelListNote: "Если список не загрузился — введите вручную (например: MiniMax-M2.7).",
  },
  {
    id: "openai_compatible",
    label: "OpenAI Compatible",
    description: "vLLM, LiteLLM, Jan, любой OpenAI-совместимый сервер",
    placeholder: "sk-… или оставьте пустым",
    keyDocsUrl: "",
    supportsModelList: true,
    modelListNote: "Список моделей загружается с вашего сервера (/v1/models).",
  },
];

// ─── Mode banner ──────────────────────────────────────────────────────────────

function ModeBanner() {
  const hosted = isHostedPreview();
  if (hosted) {
    return (
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex items-start gap-2" data-testid="hosted-preview-banner">
        <Cloud className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-xs text-blue-300 font-semibold">Preview mode — только облачные API</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Для Ollama и LM Studio запустите приложение локально (<code className="font-mono bg-black/20 px-1 rounded">npm run dev</code>).
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex items-start gap-2" data-testid="local-mode-banner">
      <Server className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <p className="text-xs text-emerald-300 font-semibold">Local mode — локальные модели доступны</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Ollama по умолчанию: <code className="font-mono bg-black/20 px-1 rounded">{DEFAULT_OLLAMA_BASE_URL}:{DEFAULT_OLLAMA_PORT}</code>. LM Studio: <code className="font-mono bg-black/20 px-1 rounded">{DEFAULT_LM_STUDIO_BASE_URL}:{DEFAULT_LM_STUDIO_PORT}</code>.
        </p>
      </div>
    </div>
  );
}

// ─── API Key input ────────────────────────────────────────────────────────────

function ApiKeyInput({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 text-sm pr-10 font-mono"
        data-testid="input-api-key-onboarding"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-toggle-key-visibility"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ─── Connection status badge ──────────────────────────────────────────────────

function ConnectionBadge({ status }: { status: { ok: boolean; message: string } | null | "checking" }) {
  if (!status) return null;
  if (status === "checking") {
    return (
      <Badge variant="outline" className="text-xs gap-1.5 text-muted-foreground" data-testid="badge-checking">
        <Loader2 className="h-3 w-3 animate-spin" />
        Проверка…
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`text-xs gap-1.5 ${status.ok ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/5" : "text-red-400 border-red-500/30 bg-red-500/5"}`}
      data-testid="badge-connection-result"
    >
      {status.ok
        ? <CheckCircle2 className="h-3 w-3" />
        : <XCircle className="h-3 w-3" />}
      {status.message}
    </Badge>
  );
}

// ─── Local provider step (shared for Ollama + LM Studio) ─────────────────────

interface LocalSetupProps {
  providerType: "ollama" | "lmstudio";
  label: string;
  defaultBaseUrl: string;
  defaultPort: number;
  setupCmd: string;
  onBack: () => void;
  onSaved: () => void;
}

function LocalProviderSetup({ providerType, label, defaultBaseUrl, defaultPort, setupCmd, onBack, onSaved }: LocalSetupProps) {
  const { toast } = useToast();
  const [port, setPort] = useState(defaultPort);
  const [baseUrl] = useState(defaultBaseUrl);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [connStatus, setConnStatus] = useState<{ ok: boolean; message: string } | null | "checking">(null);
  const hosted = isHostedPreview();

  const checkMutation = useMutation({
    mutationFn: async () => {
      setConnStatus("checking");
      const res = await apiRequest("POST", "/api/providers/check", { providerType, baseUrl, port });
      return res.json();
    },
    onSuccess: async (data) => {
      setConnStatus(data);
      if (data.ok) {
        try {
          const mRes = await apiRequest("POST", "/api/providers/models", { providerType, baseUrl, port });
          const mData = await mRes.json();
          const list: string[] = mData.models || [];
          setModels(list);
          if (list.length > 0 && !model) setModel(list[0]);
        } catch {
          // models optional
        }
      }
    },
    onError: (err: Error) => {
      setConnStatus({ ok: false, message: `Ошибка: ${err.message}` });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        providerType,
        baseUrl,
        port,
        model,
        apiKey: "",
        temperature: "0.7",
        maxTokens: 2048,
        safetyMode: "readonly",
      };
      const res = await apiRequest("POST", "/api/settings", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: `${label} подключён`, description: model ? `Модель: ${model}` : "Конфигурация сохранена" });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка сохранения", description: err.message, variant: "destructive" });
    },
  });

  const canSave = typeof connStatus === "object" && connStatus !== null && connStatus.ok && model.trim().length > 0;
  const connOk = typeof connStatus === "object" && connStatus !== null && connStatus.ok;

  return (
    <div className="max-w-lg mx-auto w-full px-4 py-8 space-y-6" data-testid="local-provider-setup">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-back-to-choose"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад
      </button>

      {/* Title */}
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">Подключить {label}</h2>
        <p className="text-sm text-muted-foreground">
          Локальная модель без облачных зависимостей. Запустите сервер, проверьте соединение и выберите модель.
        </p>
      </div>

      {/* Setup command hint */}
      <div className="bg-muted/40 border border-border rounded-lg p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground/80">
          <Info className="h-3.5 w-3.5 text-primary" />
          Как запустить {label}
        </div>
        <code className="block font-mono text-xs text-muted-foreground bg-black/10 dark:bg-white/5 rounded px-2.5 py-1.5 select-all">
          {setupCmd}
        </code>
      </div>

      {/* Port */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Адрес сервера</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              value={baseUrl}
              readOnly
              className="h-11 text-sm font-mono bg-muted/30"
              data-testid="input-base-url-onboarding"
            />
          </div>
          <span className="text-muted-foreground text-sm">:</span>
          <div className="w-28">
            <Input
              type="number"
              value={port}
              onChange={e => {
                setPort(parseInt(e.target.value) || 0);
                setConnStatus(null);
                setModels([]);
              }}
              className="h-11 text-sm font-mono text-center"
              data-testid="input-port-onboarding"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Стандартный порт {label}: <span className="font-mono">{defaultPort}</span>
        </p>
      </div>

      {/* Check connection — only available in local mode */}
      {hosted ? (
        <div className="bg-muted/30 border border-border rounded-lg p-3 text-center space-y-1.5" data-testid="check-disabled-hosted">
          <p className="text-xs text-muted-foreground font-medium">Проверка недоступна в preview mode</p>
          <p className="text-xs text-muted-foreground/70">
            Запустите приложение локально (<code className="font-mono bg-black/20 px-1 rounded">npm run dev</code>), чтобы проверить подключение к {label}.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending}
            variant="outline"
            className="w-full h-11 gap-2"
            data-testid="button-check-connection"
          >
            {checkMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Zap className="h-4 w-4" />}
            Проверить подключение
          </Button>
          {connStatus && (
            <div className="flex justify-center">
              <ConnectionBadge status={connStatus} />
            </div>
          )}
        </div>
      )}

      {/* Model selection — visible only after successful connection */}
      {connOk && (
        <div className="space-y-2 border-t border-border pt-4">
          <Label className="text-sm font-medium">Модель</Label>
          {models.length > 0 ? (
            <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {models.map(m => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors text-left ${
                    model === m
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border hover:border-muted-foreground/40 hover:bg-accent/30"
                  }`}
                  data-testid={`button-model-${m}`}
                >
                  <span className="font-mono text-xs truncate">{m}</span>
                  {model === m && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <Input
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="Введите имя модели вручную"
                className="h-11 text-sm font-mono"
                data-testid="input-model-manual"
              />
              <p className="text-xs text-muted-foreground">
                Модели не найдены автоматически — введите имя вручную
                {providerType === "lmstudio" ? ` (например: ${EXAMPLE_LM_STUDIO_MODEL})` : " (например: llama3.2, mistral)"}.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Save button */}
      {connOk && (
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !canSave}
          className="w-full h-12 gap-2 text-base font-semibold"
          data-testid="button-save-onboarding"
        >
          {saveMutation.isPending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <CheckCircle2 className="h-4 w-4" />}
          Сохранить и продолжить
        </Button>
      )}
      {connOk && !canSave && !saveMutation.isPending && (
        <p className="text-xs text-center text-muted-foreground">Выберите или введите модель, чтобы продолжить</p>
      )}
    </div>
  );
}

// ─── API Key step ─────────────────────────────────────────────────────────────

function ApiKeySetup({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [selectedProvider, setSelectedProvider] = useState<CloudProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost");
  const [port, setPort] = useState(8080);
  const [checkStatus, setCheckStatus] = useState<{ ok: boolean; message: string } | null | "checking">(null);
  const [models, setModels] = useState<string[]>([]);

  const provDef = CLOUD_PROVIDERS.find(p => p.id === selectedProvider)!;
  const isCompatible = selectedProvider === "openai_compatible";

  const checkMutation = useMutation({
    mutationFn: async () => {
      setCheckStatus("checking");
      const payload = {
        providerType: selectedProvider,
        apiKey,
        model,
        baseUrl: isCompatible ? baseUrl : "",
        port: isCompatible ? port : 0,
      };
      const res = await apiRequest("POST", "/api/providers/check", payload);
      return res.json();
    },
    onSuccess: async (data) => {
      setCheckStatus(data);
      if (data.ok) {
        // Try to load models for providers that support it
        try {
          const mRes = await apiRequest("POST", "/api/providers/models", {
            providerType: selectedProvider,
            apiKey,
            model,
            baseUrl: isCompatible ? baseUrl : "",
            port: isCompatible ? port : 0,
          });
          const mData = await mRes.json();
          const list: string[] = mData.models || [];
          setModels(list);
          if (list.length > 0 && !model) setModel(list[0]);
        } catch {
          // model listing is optional
        }
      }
    },
    onError: (err: Error) => {
      setCheckStatus({ ok: false, message: `Ошибка: ${err.message}` });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        providerType: selectedProvider as ProviderType,
        baseUrl: isCompatible ? baseUrl : "",
        port: isCompatible ? port : 0,
        model,
        apiKey,
        temperature: "0.7",
        maxTokens: 2048,
        safetyMode: "readonly",
      };
      const res = await apiRequest("POST", "/api/settings", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Конфигурация сохранена",
        description: `${provDef.label}${model ? ` · ${model}` : ""} — провайдер активен.`,
      });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка сохранения", description: err.message, variant: "destructive" });
    },
  });

  const checkOk = typeof checkStatus === "object" && checkStatus !== null && checkStatus.ok;
  const canSave = apiKey.trim().length > 0;

  return (
    <div className="max-w-lg mx-auto w-full px-4 py-8 space-y-6" data-testid="apikey-setup">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-back-to-choose-apikey"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад
      </button>

      {/* Title */}
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">Вставить API key</h2>
        <p className="text-sm text-muted-foreground">
          Облачный провайдер — без локального сервера. Выберите платформу и вставьте ключ.
        </p>
      </div>

      {/* Cloud provider tiles */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Платформа</Label>
        <div className="grid grid-cols-2 gap-2">
          {CLOUD_PROVIDERS.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelectedProvider(p.id); setApiKey(""); setModel(""); setCheckStatus(null); setModels([]); }}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selectedProvider === p.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-muted-foreground/40 hover:bg-accent/30"
              }`}
              data-testid={`button-cloud-provider-${p.id}`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-sm font-semibold">{p.label}</span>
                {selectedProvider === p.id && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">{p.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* OpenAI-compatible: baseUrl + port */}
      {isCompatible && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Адрес сервера</Label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                value={baseUrl}
                onChange={e => { setBaseUrl(e.target.value); setCheckStatus(null); }}
                placeholder="http://localhost"
                className="h-11 text-sm font-mono"
                data-testid="input-base-url-compatible"
              />
            </div>
            <span className="text-muted-foreground text-sm">:</span>
            <div className="w-28">
              <Input
                type="number"
                value={port}
                onChange={e => { setPort(parseInt(e.target.value) || 8080); setCheckStatus(null); }}
                className="h-11 text-sm font-mono text-center"
                data-testid="input-port-compatible"
              />
            </div>
          </div>
        </div>
      )}

      {/* API Key */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" />
            API Key для {provDef.label}
          </span>
          {provDef.keyDocsUrl && (
            <a
              href={provDef.keyDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
              data-testid="link-api-key-docs"
            >
              Где взять ключ?
            </a>
          )}
        </Label>
        <ApiKeyInput
          value={apiKey}
          onChange={(v) => { setApiKey(v); setCheckStatus(null); }}
          placeholder={provDef.placeholder}
        />
        <p className="text-xs text-muted-foreground">
          Ключ хранится только в локальной базе данных приложения.
        </p>
      </div>

      {/* Verify key button */}
      {apiKey.trim().length > 0 && (
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending}
            className="w-full h-10 gap-2 text-sm"
            data-testid="button-verify-api-key"
          >
            {checkMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Zap className="h-4 w-4" />}
            Проверить ключ
          </Button>
          {checkStatus && (
            <div className="flex justify-center">
              <ConnectionBadge status={checkStatus} />
            </div>
          )}
        </div>
      )}

      {/* Model — shown after check or always */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Модель</Label>
        {models.length > 0 ? (
          <div className="grid grid-cols-1 gap-1.5 max-h-44 overflow-y-auto pr-1">
            {models.slice(0, 20).map(m => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors text-left ${
                  model === m
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border hover:border-muted-foreground/40 hover:bg-accent/30"
                }`}
                data-testid={`button-cloud-model-${m}`}
              >
                <span className="font-mono text-xs truncate">{m}</span>
                {model === m && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            <Input
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder={
                selectedProvider === "openai" ? "gpt-4o, gpt-4-turbo…" :
                selectedProvider === "anthropic" ? "claude-3-5-sonnet-20241022…" :
                selectedProvider === "gemini" ? "gemini-1.5-pro…" :
                selectedProvider === "minimax" ? EXAMPLE_MINIMAX_MODEL + ", MiniMax-M2.5…" :
                "gpt-3.5-turbo, custom-model…"
              }
              className="h-11 text-sm font-mono"
              data-testid="input-cloud-model"
            />
            {!provDef.supportsModelList && provDef.modelListNote && (
              <p className="text-xs text-muted-foreground">{provDef.modelListNote}</p>
            )}
            {provDef.supportsModelList && checkOk && (
              <p className="text-xs text-muted-foreground">
                Модели загружены — выберите выше или введите название вручную.
              </p>
            )}
            {provDef.supportsModelList && !checkOk && (
              <p className="text-xs text-muted-foreground">
                Проверьте ключ выше — список моделей загрузится автоматически.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Save */}
      <Button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || !canSave}
        className="w-full h-12 gap-2 text-base font-semibold"
        data-testid="button-save-apikey-onboarding"
      >
        {saveMutation.isPending
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <CheckCircle2 className="h-4 w-4" />}
        Сохранить конфигурацию
      </Button>
      {!canSave && !saveMutation.isPending && (
        <p className="text-xs text-center text-muted-foreground">Вставьте API key, чтобы продолжить</p>
      )}
    </div>
  );
}

// ─── Choose screen ─────────────────────────────────────────────────────────────

function ChooseScreen({ onSelect }: { onSelect: (step: OnboardingStep) => void }) {
  const hosted = isHostedPreview();
  return (
    <div className="max-w-lg mx-auto w-full px-4 py-12 space-y-8" data-testid="onboarding-choose">
      {/* Logo + heading */}
      <div className="space-y-3 text-center">
        {/* SVG logo mark */}
        <div className="flex justify-center">
          <svg
            viewBox="0 0 40 40"
            width="40"
            height="40"
            fill="none"
            aria-label="Local Comet"
            className="text-primary"
          >
            <circle cx="20" cy="20" r="10" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="20" cy="20" r="4" fill="currentColor" />
            <path d="M28 12 C34 6, 38 8, 36 14 C34 20, 28 22, 28 22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.5" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Local Comet</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
          Выберите способ подключения языковой модели. Это нужно сделать один раз — потом вы увидите полный интерфейс.
        </p>
      </div>

      {/* Mode banner */}
      <ModeBanner />

      {/* Action cards — differ by mode */}
      <div className="space-y-3">
        {hosted ? (
          // ── Preview mode: only API key is the active path; local options are info-only ──
          <>
            {/* API Key — primary/only active option in preview */}
            <button
              onClick={() => onSelect("apikey")}
              className="w-full group flex items-start gap-4 p-5 rounded-xl border border-primary/40 bg-primary/5 hover:border-primary/60 hover:bg-primary/10 transition-all text-left"
              data-testid="button-onboarding-apikey"
            >
              <div className="mt-0.5 h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <KeyRound className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">Вставить API key</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30 bg-emerald-500/5">Рекомендуется</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                  OpenAI, Anthropic, Gemini или OpenAI-совместимый сервер. Работает из любого места.
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {["OpenAI", "Anthropic", "Gemini", "MiniMax", "OpenAI Compatible"].map(p => (
                    <span key={p} className="text-[10px] bg-muted/50 border border-border/50 rounded px-1.5 py-0.5 text-muted-foreground/70">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-primary/60 shrink-0 mt-2.5 group-hover:text-primary transition-colors" />
            </button>

            {/* Local providers — disabled info block, no CTA */}
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4" data-testid="local-providers-disabled">
              <p className="text-xs text-muted-foreground/70 font-semibold mb-3 uppercase tracking-wider">Локальные провайдеры — только в local mode</p>
              <div className="space-y-2">
                {/* Ollama info */}
                <div className="flex items-center gap-3 opacity-50">
                  <div className="h-8 w-8 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
                    <Server className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Ollama</span>
                      <span className="text-[10px] text-muted-foreground/60 font-mono">{DEFAULT_OLLAMA_BASE_URL}:{DEFAULT_OLLAMA_PORT}</span>
                    </div>
                    <p className="text-xs text-muted-foreground/60">Открытый движок, локальные модели</p>
                  </div>
                </div>
                {/* LM Studio info */}
                <div className="flex items-center gap-3 opacity-50">
                  <div className="h-8 w-8 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
                    <Terminal className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">LM Studio</span>
                      <span className="text-[10px] text-muted-foreground/60 font-mono">{DEFAULT_LM_STUDIO_BASE_URL}:{DEFAULT_LM_STUDIO_PORT}</span>
                    </div>
                    <p className="text-xs text-muted-foreground/60">GUI + OpenAI-совместимый API</p>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground/50 mt-3">
                Доступны после запуска приложения локально: <code className="font-mono">npm run dev</code>
              </p>
            </div>
          </>
        ) : (
          // ── Local mode: all three options are active ──
          <>
            {/* Ollama */}
            <button
              onClick={() => onSelect("ollama")}
              className="w-full group flex items-start gap-4 p-5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
              data-testid="button-onboarding-ollama"
            >
              <div className="mt-0.5 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                <Server className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">Подключить Ollama</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30 bg-emerald-500/5">Рекомендуется</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                  Открытый движок для локальных моделей. Быстрый старт, работает без интернета.
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1 font-mono">{DEFAULT_OLLAMA_BASE_URL}:{DEFAULT_OLLAMA_PORT}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-2.5 group-hover:text-primary/60 transition-colors" />
            </button>

            {/* LM Studio */}
            <button
              onClick={() => onSelect("lmstudio")}
              className="w-full group flex items-start gap-4 p-5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
              data-testid="button-onboarding-lmstudio"
            >
              <div className="mt-0.5 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                <Terminal className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">Подключить LM Studio</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30 bg-emerald-500/5">Рекомендуется</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                  GUI-приложение с OpenAI-совместимым API. Удобно для скачивания и тестирования моделей.
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1 font-mono">{DEFAULT_LM_STUDIO_BASE_URL}:{DEFAULT_LM_STUDIO_PORT}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-2.5 group-hover:text-primary/60 transition-colors" />
            </button>

            {/* API Key */}
            <button
              onClick={() => onSelect("apikey")}
              className="w-full group flex items-start gap-4 p-5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
              data-testid="button-onboarding-apikey"
            >
              <div className="mt-0.5 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                <KeyRound className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">Вставить API key</span>
                  <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30 bg-blue-500/5">Облако</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                  OpenAI, Anthropic, Gemini или OpenAI-совместимый сервер. Работает из любого места.
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {["OpenAI", "Anthropic", "Gemini", "MiniMax", "OpenAI Compatible"].map(p => (
                    <span key={p} className="text-[10px] bg-muted/50 border border-border/50 rounded px-1.5 py-0.5 text-muted-foreground/70">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-2.5 group-hover:text-primary/60 transition-colors" />
            </button>
          </>
        )}
      </div>

      {/* Skip hint */}
      <p className="text-center text-xs text-muted-foreground/50">
        Нужна помощь? Откройте{" "}
        <a
          href="#/settings"
          className="underline underline-offset-2 hover:text-muted-foreground transition-colors"
          data-testid="link-full-settings"
        >
          полные настройки
        </a>
      </p>
    </div>
  );
}

// ─── Main ProviderOnboarding screen ──────────────────────────────────────────

interface ProviderOnboardingProps {
  onComplete: () => void;
}

export default function ProviderOnboarding({ onComplete }: ProviderOnboardingProps) {
  const [step, setStep] = useState<OnboardingStep>("choose");

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center" data-testid="provider-onboarding">
      <div className="w-full">
        {step === "choose" && (
          <ChooseScreen onSelect={setStep} />
        )}
        {step === "ollama" && (
          <LocalProviderSetup
            providerType="ollama"
            label="Ollama"
            defaultBaseUrl={DEFAULT_OLLAMA_BASE_URL}
            defaultPort={DEFAULT_OLLAMA_PORT}
            setupCmd="ollama serve"
            onBack={() => setStep("choose")}
            onSaved={onComplete}
          />
        )}
        {step === "lmstudio" && (
          <LocalProviderSetup
            providerType="lmstudio"
            label="LM Studio"
            defaultBaseUrl={DEFAULT_LM_STUDIO_BASE_URL}
            defaultPort={DEFAULT_LM_STUDIO_PORT}
            setupCmd="LM Studio → Developer tab → Start Server"
            onBack={() => setStep("choose")}
            onSaved={onComplete}
          />
        )}
        {step === "apikey" && (
          <ApiKeySetup
            onBack={() => setStep("choose")}
            onSaved={onComplete}
          />
        )}
      </div>
    </div>
  );
}
