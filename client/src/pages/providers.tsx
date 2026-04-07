/**
 * Providers — model & runtime configuration.
 *
 * Layout:
 *   Left column: provider selector (local-first)
 *   Right column: provider config form + status
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import {
  Save, Zap, CheckCircle2, XCircle, Loader2,
  RefreshCw, Server, Terminal, Cloud, KeyRound, Eye, EyeOff,
  ExternalLink, AlertTriangle, Info, Star,
} from "lucide-react";
import {
  isHostedPreview,
  DEFAULT_OLLAMA_PORT, DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_LM_STUDIO_PORT, DEFAULT_LM_STUDIO_BASE_URL,
  EXAMPLE_LM_STUDIO_MODEL,
  MINIMAX_BASE_URL, EXAMPLE_MINIMAX_MODEL,
} from "@/lib/hosting-env";
import type { ProviderType } from "@shared/schema";

// ─── Provider definitions ──────────────────────────────────────────────────────

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
}

const PROVIDER_DEFS: ProviderDef[] = [
  {
    id: "ollama",
    label: "Ollama",
    icon: Server,
    description: "Local LLM server — fastest, fully private",
    defaultBaseUrl: DEFAULT_OLLAMA_BASE_URL,
    defaultPort: DEFAULT_OLLAMA_PORT,
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
    description: "Local GUI with OpenAI-compatible API",
    defaultBaseUrl: DEFAULT_LM_STUDIO_BASE_URL,
    defaultPort: DEFAULT_LM_STUDIO_PORT,
    hasPort: true,
    hasApiKey: false,
    hasBaseUrl: true,
    modelPlaceholder: EXAMPLE_LM_STUDIO_MODEL,
    category: "local",
    setupCmd: "LM Studio → Developer → Start Server",
    supportsModelList: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: Cloud,
    description: "GPT-4o, o1 — official OpenAI API",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultPort: null,
    hasPort: false,
    hasApiKey: true,
    hasBaseUrl: false,
    modelPlaceholder: "gpt-4o, gpt-4-turbo…",
    category: "cloud",
    keyDocsUrl: "https://platform.openai.com/api-keys",
    supportsModelList: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    icon: Cloud,
    description: "Claude 3.5 Sonnet, Claude 3 Haiku",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultPort: null,
    hasPort: false,
    hasApiKey: true,
    hasBaseUrl: false,
    modelPlaceholder: "claude-3-5-sonnet-20241022…",
    category: "cloud",
    keyDocsUrl: "https://console.anthropic.com/settings/keys",
    supportsModelList: false,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    icon: Cloud,
    description: "Gemini 1.5 Pro, Gemini Flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultPort: null,
    hasPort: false,
    hasApiKey: true,
    hasBaseUrl: false,
    modelPlaceholder: "gemini-1.5-pro, gemini-flash…",
    category: "cloud",
    keyDocsUrl: "https://aistudio.google.com/app/apikey",
    supportsModelList: true,
  },
  {
    id: "minimax",
    label: "MiniMax",
    icon: Cloud,
    description: "MiniMax-M2 — cloud OpenAI-compatible API",
    defaultBaseUrl: MINIMAX_BASE_URL,
    defaultPort: null,
    hasPort: false,
    hasApiKey: true,
    hasBaseUrl: false,
    modelPlaceholder: EXAMPLE_MINIMAX_MODEL,
    category: "cloud",
    keyDocsUrl: "https://platform.minimaxi.com",
    supportsModelList: true,
  },
  {
    id: "openai_compatible",
    label: "OpenAI-compatible",
    icon: Cloud,
    description: "Any custom endpoint with OpenAI-style API",
    defaultBaseUrl: "http://localhost:8080",
    defaultPort: 8080,
    hasPort: true,
    hasApiKey: true,
    hasBaseUrl: true,
    modelPlaceholder: "model-name",
    category: "cloud",
    supportsModelList: true,
  },
];

// ─── Provider selector card ───────────────────────────────────────────────────

function ProviderCard({ def, active, onClick }: { def: ProviderDef; active: boolean; onClick: () => void }) {
  const Icon = def.icon;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-all border ${
        active
          ? "bg-primary/10 border-primary/30 text-primary"
          : "bg-transparent border-transparent hover:bg-muted/60 text-foreground"
      }`}
      data-testid={`provider-card-${def.id}`}
    >
      <div className={`mt-0.5 flex-shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{def.label}</span>
          {def.category === "local" && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase tracking-wider">local</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{def.description}</p>
      </div>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const { toast } = useToast();
  const hosted = isHostedPreview();

  const settingsQuery = useQuery<any>({ queryKey: ["/api/settings"], staleTime: 15_000 });

  const [selectedProvider, setSelectedProvider] = useState<ProviderType>("ollama");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_OLLAMA_BASE_URL);
  const [port, setPort] = useState<number>(DEFAULT_OLLAMA_PORT);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [checkStatus, setCheckStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const def = PROVIDER_DEFS.find((d) => d.id === selectedProvider) || PROVIDER_DEFS[0];

  // Populate form from saved settings on first load
  useEffect(() => {
    if (!settingsQuery.data) return;
    const s = settingsQuery.data;
    if (s.providerType) setSelectedProvider(s.providerType as ProviderType);
    if (s.baseUrl) setBaseUrl(s.baseUrl);
    if (s.port) setPort(s.port);
    if (s.model) setModel(s.model);
    if (s.apiKey) setApiKey(s.apiKey);
    if (s.temperature) setTemperature(parseFloat(s.temperature));
    if (s.maxTokens) setMaxTokens(s.maxTokens);
  }, [settingsQuery.data]);

  // Reset defaults when provider changes
  const handleSelectProvider = (pType: ProviderType) => {
    setSelectedProvider(pType);
    setCheckStatus(null);
    setModelList([]);
    const d = PROVIDER_DEFS.find((x) => x.id === pType)!;
    setBaseUrl(d.defaultBaseUrl);
    if (d.defaultPort) setPort(d.defaultPort);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", "/api/settings", {
        providerType: selectedProvider,
        baseUrl,
        port,
        model,
        apiKey,
        temperature: String(temperature),
        maxTokens,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/computer/status"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const handleCheck = async () => {
    setChecking(true);
    setCheckStatus(null);
    try {
      const res = await apiRequest("POST", "/api/provider/check", {
        providerType: selectedProvider,
        baseUrl,
        port,
        model,
        apiKey,
      });
      const data = await res.json();
      setCheckStatus({ ok: data.ok, message: data.message || (data.ok ? "Connected" : "Failed") });
    } catch (e: any) {
      setCheckStatus({ ok: false, message: e.message });
    } finally {
      setChecking(false);
    }
  };

  const handleLoadModels = async () => {
    setModelListLoading(true);
    try {
      const res = await apiRequest("POST", "/api/provider/models", {
        providerType: selectedProvider,
        baseUrl,
        port,
        apiKey,
      });
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        setModelList(data.models);
      } else {
        toast({ title: "No models found", description: "Check your connection settings." });
      }
    } catch (e: any) {
      toast({ title: "Failed to load models", description: e.message, variant: "destructive" });
    } finally {
      setModelListLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-card/50 flex-shrink-0">
        <Server className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Providers</span>
        <Badge variant="outline" className="text-[10px] text-primary border-primary/30 gap-1">
          <Star className="h-2.5 w-2.5" /> local-first
        </Badge>
        {hosted && (
          <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 gap-1 ml-2">
            <AlertTriangle className="h-2.5 w-2.5" /> Hosted preview — local providers unavailable
          </Badge>
        )}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: provider list */}
        <div className="w-56 flex-shrink-0 border-r border-border overflow-y-auto p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 mb-2">Local (recommended)</div>
          {PROVIDER_DEFS.filter((d) => d.category === "local").map((d) => (
            <ProviderCard key={d.id} def={d} active={selectedProvider === d.id} onClick={() => handleSelectProvider(d.id)} />
          ))}

          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 mb-2 mt-4">Cloud APIs</div>
          {PROVIDER_DEFS.filter((d) => d.category === "cloud").map((d) => (
            <ProviderCard key={d.id} def={d} active={selectedProvider === d.id} onClick={() => handleSelectProvider(d.id)} />
          ))}
        </div>

        {/* Right: config form */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="max-w-lg">
            <div className="flex items-center gap-2 mb-5">
              <def.icon className="h-5 w-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">{def.label}</h2>
              <Badge variant={def.category === "local" ? "outline" : "secondary"} className={`text-[10px] ${def.category === "local" ? "text-primary border-primary/30" : ""}`}>
                {def.category}
              </Badge>
            </div>

            {/* Local provider: hosted warning */}
            {def.category === "local" && hosted && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/25 bg-amber-500/5 mb-5 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium text-foreground">Not available in hosted preview</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Local providers (Ollama, LM Studio) require running the app locally next to your models.
                    Run <code className="font-mono bg-muted px-1 rounded">npm run dev</code> on your own machine.
                  </p>
                </div>
              </div>
            )}

            {/* Setup command hint for local providers */}
            {def.setupCmd && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border mb-5 text-xs">
                <Terminal className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Start server:</span>
                <code className="font-mono text-foreground">{def.setupCmd}</code>
              </div>
            )}

            <div className="space-y-4">
              {/* Base URL */}
              {def.hasBaseUrl && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Base URL</Label>
                  <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="font-mono text-sm" data-testid="input-base-url" />
                </div>
              )}

              {/* Port */}
              {def.hasPort && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Port</Label>
                  <Input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value) || 0)}
                    className="font-mono text-sm w-32"
                    data-testid="input-port"
                  />
                </div>
              )}

              {/* API Key */}
              {def.hasApiKey && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">API Key</Label>
                    {def.keyDocsUrl && (
                      <a
                        href={def.keyDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        Get key <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      type={showApiKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="font-mono text-sm pr-9"
                      placeholder="sk-…"
                      data-testid="input-api-key"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Model */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">Model</Label>
                  {def.supportsModelList && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2 text-muted-foreground"
                      onClick={handleLoadModels}
                      disabled={modelListLoading}
                      data-testid="button-load-models"
                    >
                      {modelListLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      Load list
                    </Button>
                  )}
                </div>
                {modelList.length > 0 ? (
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="text-sm font-mono" data-testid="select-model">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelList.map((m) => (
                        <SelectItem key={m} value={m} className="font-mono text-sm">{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={def.modelPlaceholder}
                    className="font-mono text-sm"
                    data-testid="input-model"
                  />
                )}
              </div>

              {/* Temperature */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">Temperature</Label>
                  <span className="text-xs font-mono text-foreground">{temperature.toFixed(1)}</span>
                </div>
                <Slider
                  value={[temperature]}
                  onValueChange={([v]) => setTemperature(v)}
                  min={0}
                  max={2}
                  step={0.1}
                  data-testid="slider-temperature"
                />
              </div>

              {/* Max tokens */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">Max tokens</Label>
                  <span className="text-xs font-mono text-foreground">{maxTokens.toLocaleString()}</span>
                </div>
                <Slider
                  value={[maxTokens]}
                  onValueChange={([v]) => setMaxTokens(v)}
                  min={256}
                  max={32768}
                  step={256}
                  data-testid="slider-max-tokens"
                />
              </div>

              {/* Check + status */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={handleCheck}
                  disabled={checking}
                  data-testid="button-check"
                >
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Test connection
                </Button>
                {checkStatus && (
                  <div className={`flex items-center gap-1.5 text-sm ${checkStatus.ok ? "text-green-500" : "text-destructive"}`}>
                    {checkStatus.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {checkStatus.message}
                  </div>
                )}
              </div>

              {/* Save */}
              <Button
                className="w-full gap-1.5 mt-2"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="button-save"
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save settings
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
