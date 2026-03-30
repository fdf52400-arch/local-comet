import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Save, Zap, CheckCircle2, XCircle, Loader2,
  RefreshCw, MessageSquare, ShieldCheck, ShieldAlert, Shield,
} from "lucide-react";
import { Link } from "wouter";

export default function SettingsPage() {
  const { toast } = useToast();

  const settingsQuery = useQuery<any>({
    queryKey: ["/api/settings"],
  });

  const [form, setForm] = useState({
    providerType: "ollama",
    baseUrl: "http://localhost",
    port: 11434,
    model: "",
    temperature: "0.7",
    maxTokens: 2048,
    safetyMode: "readonly",
  });

  const [models, setModels] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<{ok: boolean; message: string} | null>(null);
  const [autoChecked, setAutoChecked] = useState(false);

  useEffect(() => {
    if (settingsQuery.data && settingsQuery.data.providerType) {
      const d = settingsQuery.data;
      setForm({
        providerType: d.providerType || "ollama",
        baseUrl: d.baseUrl || "http://localhost",
        port: d.port || 11434,
        model: d.model || "",
        temperature: d.temperature || "0.7",
        maxTokens: d.maxTokens || 2048,
        safetyMode: d.safetyMode || "readonly",
      });
      // Auto-check connection and load models on first settings load
      if (!autoChecked) {
        setAutoChecked(true);
        setTimeout(() => {
          checkMutation.mutateAsync().then(r => setConnectionStatus(r)).catch(() => {});
          modelsMutation.mutateAsync().then(r => { if (r.models) setModels(r.models); }).catch(() => {});
        }, 300);
      }
    }
  }, [settingsQuery.data]);

  // Auto-set default port when provider changes
  useEffect(() => {
    if (form.providerType === "ollama" && form.port === 1234) {
      setForm(f => ({ ...f, port: 11434 }));
    } else if (form.providerType === "lmstudio" && form.port === 11434) {
      setForm(f => ({ ...f, port: 1234 }));
    }
  }, [form.providerType]);

  // Check provider
  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/providers/check", {
        providerType: form.providerType,
        baseUrl: form.baseUrl,
        port: form.port,
      });
      return res.json();
    },
    onSuccess: (data) => { setConnectionStatus(data); },
  });

  // List models
  const modelsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/providers/models", {
        providerType: form.providerType,
        baseUrl: form.baseUrl,
        port: form.port,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setModels(data.models || []);
      if (data.models?.length > 0 && !form.model) {
        setForm(f => ({ ...f, model: data.models[0] }));
      }
      if (data.error) {
        toast({ title: "Ошибка получения моделей", description: data.error, variant: "destructive" });
      }
    },
  });

  // Test chat
  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/chat/test", form);
      return res.json();
    },
  });

  // Save settings
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
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Provider type */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Провайдер модели</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setForm(f => ({ ...f, providerType: "ollama" }))}
                className={`p-3 rounded-lg border transition-colors text-left ${
                  form.providerType === "ollama"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/30"
                }`}
                data-testid="button-provider-ollama"
              >
                <div className="text-sm font-semibold">Ollama</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Порт по умолчанию: 11434</div>
              </button>
              <button
                onClick={() => setForm(f => ({ ...f, providerType: "lmstudio" }))}
                className={`p-3 rounded-lg border transition-colors text-left ${
                  form.providerType === "lmstudio"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/30"
                }`}
                data-testid="button-provider-lmstudio"
              >
                <div className="text-sm font-semibold">LM Studio</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Порт по умолчанию: 1234</div>
              </button>
            </div>
          </Card>

          {/* Connection */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Подключение</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Base URL</Label>
                  <Input
                    value={form.baseUrl}
                    onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
                    className="h-9 text-sm mt-1"
                    data-testid="input-base-url"
                  />
                </div>
                <div>
                  <Label className="text-xs">Порт</Label>
                  <Input
                    type="number"
                    value={form.port}
                    onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 0 }))}
                    className="h-9 text-sm mt-1"
                    data-testid="input-port"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => checkMutation.mutate()}
                  disabled={checkMutation.isPending}
                  className="gap-2 text-xs"
                  data-testid="button-check-connection"
                >
                  {checkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Проверить подключение
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => modelsMutation.mutate()}
                  disabled={modelsMutation.isPending}
                  className="gap-2 text-xs"
                  data-testid="button-load-models"
                >
                  {modelsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Загрузить модели
                </Button>
              </div>
              {connectionStatus && (
                <div className={`text-xs flex items-center gap-2 p-2 rounded-md ${connectionStatus.ok ? "text-green-500 bg-green-500/10" : "text-red-400 bg-red-500/10"}`}>
                  {connectionStatus.ok ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <XCircle className="h-3 w-3 shrink-0" />}
                  {connectionStatus.message}
                  {connectionStatus.ok && models.length > 0 && (
                    <span className="ml-auto text-[10px] text-muted-foreground">{models.length} моделей доступно</span>
                  )}
                </div>
              )}
              {settingsQuery.isLoading && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Проверка подключения...
                </div>
              )}
            </div>
          </Card>

          {/* Model */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Модель</h3>
            <div className="space-y-3">
              {models.length > 0 ? (
                <Select
                  value={form.model}
                  onValueChange={v => setForm(f => ({ ...f, model: v }))}
                >
                  <SelectTrigger className="h-9 text-sm" data-testid="select-model">
                    <SelectValue placeholder="Выберите модель" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div>
                  <Label className="text-xs">Название модели</Label>
                  <Input
                    value={form.model}
                    onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                    placeholder="например, llama3.2 или mistral"
                    className="h-9 text-sm mt-1"
                    data-testid="input-model-name"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Нажмите «Загрузить модели» для автоопределения или введите вручную
                  </p>
                </div>
              )}

              <div>
                <Label className="text-xs">Temperature: {form.temperature}</Label>
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  value={[parseFloat(form.temperature)]}
                  onValueChange={([v]) => setForm(f => ({ ...f, temperature: v.toFixed(1) }))}
                  className="mt-2"
                  data-testid="slider-temperature"
                />
              </div>

              <div>
                <Label className="text-xs">Max tokens</Label>
                <Input
                  type="number"
                  value={form.maxTokens}
                  onChange={e => setForm(f => ({ ...f, maxTokens: parseInt(e.target.value) || 2048 }))}
                  className="h-9 text-sm mt-1"
                  data-testid="input-max-tokens"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !form.model}
                className="gap-2 text-xs"
                data-testid="button-test-chat"
              >
                {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
                Тестовый запрос
              </Button>
              {testMutation.data && (
                <div className={`text-xs ${testMutation.data.ok ? "text-green-500" : "text-red-400"}`}>
                  {testMutation.data.ok
                    ? `✓ Ответ: ${testMutation.data.response?.content?.slice(0, 200)}`
                    : `✗ ${testMutation.data.error}`
                  }
                </div>
              )}
            </div>
          </Card>

          {/* Safety mode */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Режим безопасности</h3>
            <div className="space-y-2">
              {[
                { key: "readonly", label: "Только чтение", desc: "Агент может только читать страницы, без клиётов и вводов", icon: ShieldCheck },
                { key: "confirm", label: "С подтверждением", desc: "Агент запросит подтверждение перед кликами и вводом", icon: ShieldAlert },
                { key: "full", label: "Полный доступ", desc: "Все безопасные действия разрешены автоматически", icon: Shield },
              ].map(mode => (
                <button
                  key={mode.key}
                  onClick={() => setForm(f => ({ ...f, safetyMode: mode.key }))}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-colors text-left ${
                    form.safetyMode === mode.key
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-muted-foreground/30"
                  }`}
                  data-testid={`button-safety-${mode.key}`}
                >
                  <mode.icon className={`h-4 w-4 mt-0.5 shrink-0 ${form.safetyMode === mode.key ? "text-primary" : "text-muted-foreground"}`} />
                  <div>
                    <div className="text-sm font-medium">{mode.label}</div>
                    <div className="text-[11px] text-muted-foreground">{mode.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {/* Save button */}
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full gap-2"
            data-testid="button-save-settings"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить настройки
          </Button>
        </div>
      </div>
    </div>
  );
}
