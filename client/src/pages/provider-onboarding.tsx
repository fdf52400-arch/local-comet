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

// ─── Types ────────────────────────────────────────────────────────────────────

type OnboardingStep =
  | "choose"          // initial — pick one of 3 big options
  | "ollama"          // configure Ollama
  | "lmstudio"        // configure LM Studio
  | "apikey";         // pick cloud provider + enter key

type CloudProvider = "openai_compatible" | "openai" | "anthropic" | "gemini";

// ─── Cloud provider definitions ───────────────────────────────────────────────

interface CloudProviderDef {
  id: CloudProvider;
  label: string;
  description: string;
  placeholder: string;
  note: string;
}

const CLOUD_PROVIDERS: CloudProviderDef[] = [
  {
    id: "openai_compatible",
    label: "OpenAI Compatible",
    description: "vLLM, LiteLLM, Jan, любой OpenAI-совместимый сервер",
    placeholder: "sk-… или оставьте пустым",
    note: "Конфигурация сохраняется. Агент пока работает только через Ollama / LM Studio.",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o, GPT-4-turbo, o1 — официальный API OpenAI",
    placeholder: "sk-…",
    note: "Конфигурация и API-ключ сохраняются. Агент пока работает только через Ollama / LM Studio.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude 3.5, Claude 3 Haiku — официальный API Anthropic",
    placeholder: "sk-ant-…",
    note: "Конфигурация и API-ключ сохраняются. Агент пока работает только через Ollama / LM Studio.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini 1.5 Pro, Gemini Flash — Google AI API",
    placeholder: "AIza…",
    note: "Конфигурация и API-ключ сохраняются. Агент пока работает только через Ollama / LM Studio.",
  },
];

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
  defaultPort: number;
  setupCmd: string;
  onBack: () => void;
  onSaved: () => void;
}

function LocalProviderSetup({ providerType, label, defaultPort, setupCmd, onBack, onSaved }: LocalSetupProps) {
  const { toast } = useToast();
  const [port, setPort] = useState(defaultPort);
  const [baseUrl] = useState("http://localhost");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [connStatus, setConnStatus] = useState<{ ok: boolean; message: string } | null | "checking">(null);

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

      {/* Check connection */}
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
                Модели не найдены автоматически — введите имя вручную (например: llama3.2, mistral).
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

  const provDef = CLOUD_PROVIDERS.find(p => p.id === selectedProvider)!;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        providerType: selectedProvider as ProviderType,
        baseUrl: selectedProvider === "openai_compatible" ? "http://localhost" : "",
        port: selectedProvider === "openai_compatible" ? 8080 : 0,
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
        description: `${provDef.label}${model ? ` · ${model}` : ""} — агент запустится, когда поддержка этого провайдера будет добавлена.`,
      });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка сохранения", description: err.message, variant: "destructive" });
    },
  });

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
              onClick={() => { setSelectedProvider(p.id); setApiKey(""); setModel(""); }}
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

      {/* API Key */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          API Key для {provDef.label}
        </Label>
        <ApiKeyInput
          value={apiKey}
          onChange={setApiKey}
          placeholder={provDef.placeholder}
        />
        <p className="text-xs text-muted-foreground">
          Ключ хранится только в локальной базе данных приложения.
        </p>
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Модель (опционально)</Label>
        <Input
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder={
            selectedProvider === "openai" ? "gpt-4o, gpt-4-turbo…" :
            selectedProvider === "anthropic" ? "claude-3-5-sonnet-20241022…" :
            selectedProvider === "gemini" ? "gemini-1.5-pro…" :
            "gpt-3.5-turbo, custom-model…"
          }
          className="h-11 text-sm font-mono"
          data-testid="input-cloud-model"
        />
      </div>

      {/* Config-only notice */}
      <div className="bg-blue-500/8 border border-blue-500/25 rounded-lg p-3 flex items-start gap-2" data-testid="config-only-notice-onboarding">
        <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-xs text-blue-300 font-semibold">Конфигурация сохраняется, агент пока недоступен</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{provDef.note}</p>
        </div>
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

      {/* 3 big action cards */}
      <div className="space-y-3">
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
            <p className="text-xs text-muted-foreground/60 mt-1 font-mono">localhost:11434</p>
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
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
              GUI-приложение с OpenAI-совместимым API. Удобно для скачивания и тестирования моделей.
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1 font-mono">localhost:1234</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-2.5 group-hover:text-primary/60 transition-colors" />
        </button>

        {/* API Key */}
        <button
          onClick={() => onSelect("apikey")}
          className="w-full group flex items-start gap-4 p-5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
          data-testid="button-onboarding-apikey"
        >
          <div className="mt-0.5 h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-muted/80 transition-colors">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">Вставить API key</span>
              <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30 bg-blue-500/5">Облако</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
              OpenAI, Anthropic, Gemini или OpenAI-совместимый сервер. Конфигурация сохраняется.
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {["OpenAI", "Anthropic", "Gemini", "OpenAI Compatible"].map(p => (
                <span key={p} className="text-[10px] bg-muted/50 border border-border/50 rounded px-1.5 py-0.5 text-muted-foreground/70">
                  {p}
                </span>
              ))}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-2.5 group-hover:text-primary/60 transition-colors" />
        </button>
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
            defaultPort={11434}
            setupCmd="ollama serve"
            onBack={() => setStep("choose")}
            onSaved={onComplete}
          />
        )}
        {step === "lmstudio" && (
          <LocalProviderSetup
            providerType="lmstudio"
            label="LM Studio"
            defaultPort={1234}
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
