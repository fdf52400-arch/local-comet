import { useState, useRef, useEffect } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  ExternalLink,
  Bot,
  Star,
  StarOff,
  Trash2,
  Filter,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  AlertCircle,
  Loader2,
  Zap,
  Brain,
  Globe,
  Database,
  Info,
  TrendingUp,
  X,
  CheckCircle2,
  SlidersHorizontal,
  Layers,
  Mail,
  Hand,
  MonitorSmartphone,
  ClipboardPaste,
  MessageSquarePlus,
  Copy,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import type { KworkLead } from "@shared/schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBudget(budget: number): string {
  return budget.toLocaleString("ru-RU") + " ₽";
}

function safeParseJson(str: string): string[] {
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-500";
  if (score >= 40) return "text-amber-500";
  return "text-red-500";
}

function scoreBg(score: number): string {
  if (score >= 70) return "bg-emerald-500/10 border-emerald-500/20";
  if (score >= 40) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function recommendationLabel(rec: string): string {
  if (rec === "strong_fit") return "Strong Fit";
  if (rec === "review_manually") return "Review Manually";
  return "Reject";
}

function recommendationIcon(rec: string) {
  if (rec === "strong_fit") return <CircleCheck className="w-4 h-4 text-emerald-500" />;
  if (rec === "review_manually") return <AlertCircle className="w-4 h-4 text-amber-500" />;
  return <CircleX className="w-4 h-4 text-red-500" />;
}

function recommendationBadgeClass(rec: string): string {
  if (rec === "strong_fit") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
  if (rec === "review_manually") return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
  return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "shortlisted": return "bg-violet-500/10 text-violet-500 border-violet-500/20";
    case "opened": return "bg-sky-500/10 text-sky-500 border-sky-500/20";
    case "in_review": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    case "rejected": return "bg-neutral-500/10 text-neutral-500 border-neutral-500/20";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "new": return "Новый";
    case "shortlisted": return "В шортлисте";
    case "opened": return "Открыт";
    case "in_review": return "Computer review";
    case "rejected": return "Отклонён";
    default: return status;
  }
}

function sourceIcon(source: string) {
  if (source === "email") return <Mail className="w-3 h-3" />;
  if (source === "browser") return <Globe className="w-3 h-3" />;
  return <Hand className="w-3 h-3" />;
}

// ─── Intake Form ──────────────────────────────────────────────────────────────

interface IntakeFormProps {
  onClose: () => void;
  onCreated: () => void;
}

function IntakeForm({ onClose, onCreated }: IntakeFormProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: "",
    budget: "",
    category: "",
    brief: "",
    orderUrl: "",
    source: "manual",
    flagFitsProfile: false,
    flagNeedsCall: false,
    flagNeedsAccess: false,
    flagNeedsDesign: false,
    flagNeedsMobile: false,
    flagCloudVmFit: false,
  });
  const [preview, setPreview] = useState<null | { fitScore: number; recommendation: string; whyFits: string[]; keyRisks: string[] }>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsePending, setParsePending] = useState(false);

  const parseBrief = async () => {
    if (!pasteText.trim()) return;
    setParsePending(true);
    try {
      const res = await apiRequest("POST", "/api/kwork/parse-brief", { text: pasteText });
      const data = await res.json();
      if (data.error) { toast({ title: "Ошибка разбора", description: data.error, variant: "destructive" }); return; }
      setForm(f => ({
        ...f,
        title: data.title || f.title,
        budget: data.budget ? String(data.budget) : f.budget,
        category: data.category || f.category,
        brief: data.brief || f.brief,
        orderUrl: data.orderUrl || f.orderUrl,
        flagFitsProfile: data.flagFitsProfile ?? f.flagFitsProfile,
        flagNeedsCall: data.flagNeedsCall ?? f.flagNeedsCall,
        flagNeedsAccess: data.flagNeedsAccess ?? f.flagNeedsAccess,
        flagNeedsDesign: data.flagNeedsDesign ?? f.flagNeedsDesign,
        flagNeedsMobile: data.flagNeedsMobile ?? f.flagNeedsMobile,
        flagCloudVmFit: data.flagCloudVmFit ?? f.flagCloudVmFit,
        source: "manual",
      }));
      setPasteMode(false);
      toast({ title: "Поля заполнены автоматически", description: "Проверьте и скорректируйте при необходимости" });
    } catch (e: any) {
      toast({ title: "Ошибка разбора", description: e.message, variant: "destructive" });
    } finally {
      setParsePending(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/kwork/leads", {
        ...data,
        budget: parseInt(data.budget) || 0,
        budgetRaw: data.budget ? `${parseInt(data.budget).toLocaleString("ru-RU")} ₽` : "",
        receivedAt: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kwork/leads"] });
      toast({ title: "Лид добавлен", description: "Scoring выполнен автоматически" });
      onCreated();
    },
    onError: (e: any) => {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    },
  });

  async function previewScore() {
    setPreviewLoading(true);
    try {
      const res = await apiRequest("POST", "/api/kwork/score-preview", {
        ...form,
        budget: parseInt(form.budget) || 0,
      });
      const data = await res.json();
      setPreview(data);
    } catch {
      toast({ title: "Ошибка preview", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  const flagFields: { key: keyof typeof form; label: string }[] = [
    { key: "flagFitsProfile", label: "Подходит под профиль" },
    { key: "flagCloudVmFit", label: "Computer + Cloud VM fit" },
    { key: "flagNeedsCall", label: "Нужен ручной созвон" },
    { key: "flagNeedsAccess", label: "Нужен доступ к аккаунтам" },
    { key: "flagNeedsDesign", label: "Нужен дизайн" },
    { key: "flagNeedsMobile", label: "Нужен мобильный стек" },
  ];

  return (
    <div className="space-y-4">
      {/* Paste brief button */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPasteMode(!pasteMode)}
          className="gap-1.5 text-xs"
          data-testid="button-paste-brief"
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
          Вставить брифинг
        </Button>
        <span className="text-[11px] text-muted-foreground">или заполните поля вручную ниже</span>
      </div>

      {/* Paste mode */}
      {pasteMode && (
        <div className="space-y-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
          <label className="text-xs font-medium text-muted-foreground block">Вставьте текст из Kwork / email-дайджеста</label>
          <Textarea
            data-testid="input-paste-brief"
            placeholder="Вставьте текст проекта, описание из email, или скопированный brief..."
            rows={6}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={parseBrief}
              disabled={parsePending || !pasteText.trim()}
              className="gap-1.5 text-xs"
              data-testid="button-parse-brief"
            >
              {parsePending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Разобрать автоматически
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setPasteMode(false); setPasteText(""); }}
              className="text-xs"
            >
              Отмена
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Название проекта *</label>
          <Input
            data-testid="input-lead-title"
            placeholder="Разработка Telegram-бота с GPT..."
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Бюджет (₽)</label>
          <Input
            data-testid="input-lead-budget"
            type="number"
            placeholder="75000"
            value={form.budget}
            onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Источник</label>
          <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
            <SelectTrigger data-testid="select-source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email-дайджест</SelectItem>
              <SelectItem value="manual">Вручную</SelectItem>
              <SelectItem value="browser">Браузер</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Категория</label>
          <Input
            data-testid="input-lead-category"
            placeholder="AI / Telegram боты / Парсинг"
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Ссылка на заказ</label>
          <Input
            data-testid="input-lead-url"
            placeholder="https://kwork.ru/projects/..."
            value={form.orderUrl}
            onChange={e => setForm(f => ({ ...f, orderUrl: e.target.value }))}
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Краткое ТЗ / описание
            {!form.orderUrl && (
              <span className="ml-2 text-amber-500 text-[11px]">⚠ без URL — только частичный анализ</span>
            )}
          </label>
          <Textarea
            data-testid="input-lead-brief"
            placeholder="Описание проекта из email или собственные заметки..."
            rows={4}
            value={form.brief}
            onChange={e => setForm(f => ({ ...f, brief: e.target.value }))}
          />
        </div>
      </div>

      {/* Flags */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Признаки</label>
        <div className="grid grid-cols-2 gap-2">
          {flagFields.map(({ key, label }) => (
            <button
              key={key}
              data-testid={`flag-${key}`}
              type="button"
              onClick={() => setForm(f => ({ ...f, [key]: !f[key as keyof typeof form] }))}
              className={`text-left text-xs px-3 py-2 rounded-md border transition-colors ${
                form[key as keyof typeof form]
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {form[key as keyof typeof form] ? "✓ " : ""}{label}
            </button>
          ))}
        </div>
      </div>

      {/* Score preview */}
      {preview && (
        <div className={`rounded-lg border p-3 ${scoreBg(preview.fitScore)}`}>
          <div className="flex items-center gap-2 mb-2">
            {recommendationIcon(preview.recommendation)}
            <span className="text-sm font-semibold">{recommendationLabel(preview.recommendation)}</span>
            <span className={`ml-auto font-bold ${scoreColor(preview.fitScore)}`}>{preview.fitScore}/100</span>
          </div>
          {preview.whyFits.length > 0 && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">
              {preview.whyFits.slice(0, 3).map((w, i) => <div key={i}>+ {w}</div>)}
            </div>
          )}
          {preview.keyRisks.length > 0 && (
            <div className="text-xs text-red-500">
              {preview.keyRisks.slice(0, 3).map((r, i) => <div key={i}>− {r}</div>)}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          data-testid="button-preview-score"
          variant="outline"
          size="sm"
          onClick={previewScore}
          disabled={previewLoading || !form.title}
        >
          {previewLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <TrendingUp className="w-4 h-4 mr-1" />}
          Preview score
        </Button>
        <Button
          data-testid="button-cancel-intake"
          variant="outline"
          size="sm"
          onClick={onClose}
          className="ml-auto"
        >
          Отмена
        </Button>
        <Button
          data-testid="button-submit-lead"
          size="sm"
          onClick={() => createMutation.mutate(form)}
          disabled={createMutation.isPending || !form.title}
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
          Добавить лид
        </Button>
      </div>
    </div>
  );
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

interface LeadCardProps {
  lead: KworkLead;
  onUpdate: () => void;
}

function LeadCard({ lead, onUpdate, providerOk }: LeadCardProps & { providerOk: boolean }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<"model" | "template" | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const whyFits = safeParseJson(lead.whyFits);
  const keyRisks = safeParseJson(lead.keyRisks);

  const generateDraft = async () => {
    setDraftLoading(true);
    try {
      const res = await apiRequest("POST", "/api/kwork/response-draft", { leadId: lead.id });
      const data = await res.json();
      if (data.error) { toast({ title: "Ошибка", description: data.error, variant: "destructive" }); return; }
      setDraft(data.draft);
      setDraftSource(data.source);
    } catch (e: any) {
      toast({ title: "Ошибка генерации", description: e.message, variant: "destructive" });
    } finally {
      setDraftLoading(false);
    }
  };

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      toast({ title: "Отклик скопирован" });
    } catch {
      toast({ title: "Не удалось скопировать", variant: "destructive" });
    }
  };

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<KworkLead>) => {
      const res = await apiRequest("PATCH", `/api/kwork/leads/${lead.id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kwork/leads"] });
      onUpdate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/kwork/leads/${lead.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kwork/leads"] });
    },
  });

  const openMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/kwork/leads/${lead.id}/open`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/kwork/leads"] });
      if (data.canOpenDirectly && data.orderUrl) {
        window.open(data.orderUrl, "_blank", "noopener");
        toast({ title: "Открываем заказ", description: data.orderUrl });
      } else {
        toast({
          title: "URL заказа недоступен",
          description: data.message,
          variant: "default",
        });
      }
    },
  });

  const computerReviewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/kwork/leads/${lead.id}/computer-review`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/kwork/leads"] });
      toast({
        title: "Computer review запущен",
        description: data.message,
      });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    },
  });

  const toggleShortlist = () => {
    updateMutation.mutate({ isShortlisted: lead.isShortlisted === 1 ? 0 : 1 });
  };

  const isRejected = lead.recommendation === "reject" || lead.status === "rejected";

  return (
    <div
      data-testid={`card-lead-${lead.id}`}
      className={`rounded-xl border bg-card transition-all ${
        isRejected ? "opacity-60" : ""
      } ${lead.isShortlisted === 1 ? "border-violet-500/30" : "border-card-border"}`}
    >
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Score circle */}
          <div className={`flex-none w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
            lead.fitScore >= 70
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : lead.fitScore >= 40
              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "border-red-500/40 bg-red-500/10 text-red-500"
          }`}>
            {lead.fitScore}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${recommendationBadgeClass(lead.recommendation)}`}>
                {recommendationIcon(lead.recommendation)}
                {recommendationLabel(lead.recommendation)}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${statusBadgeClass(lead.status)}`}>
                {statusLabel(lead.status)}
              </span>
              {lead.isShortlisted === 1 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-violet-500/10 text-violet-500 border border-violet-500/20">
                  <Star className="w-3 h-3" /> Shortlist
                </span>
              )}
            </div>

            <h3 className="font-medium text-sm leading-snug line-clamp-2">{lead.title}</h3>

            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-sm font-semibold text-primary">{formatBudget(lead.budget)}</span>
              {lead.category && (
                <span className="text-xs text-muted-foreground">{lead.category}</span>
              )}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                {sourceIcon(lead.source)}
                {lead.source === "email" ? "Email" : lead.source === "browser" ? "Browser" : "Manual"}
              </span>
              {!lead.orderUrl && (
                <span className="text-xs text-amber-500 flex items-center gap-1">
                  <Info className="w-3 h-3" /> нет URL
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex-none flex items-center gap-1">
            <button
              data-testid={`button-shortlist-${lead.id}`}
              onClick={toggleShortlist}
              title={lead.isShortlisted ? "Убрать из шортлиста" : "Добавить в шортлист"}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
            >
              {lead.isShortlisted === 1
                ? <Star className="w-4 h-4 text-violet-500" />
                : <StarOff className="w-4 h-4 text-muted-foreground" />
              }
            </button>
            <button
              data-testid={`button-expand-${lead.id}`}
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
            >
              {expanded
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />
              }
            </button>
          </div>
        </div>

        {/* Score bar */}
        <div className="mt-3">
          <Progress
            value={lead.fitScore}
            className="h-1.5"
          />
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">

          {/* Brief */}
          {lead.brief ? (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">ТЗ / Описание</div>
              <p className="text-sm text-foreground/80 leading-relaxed">{lead.brief}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm">
                <AlertCircle className="w-4 h-4 flex-none" />
                <div>
                  <div className="font-medium">Полное ТЗ недоступно</div>
                  <div className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                    Лид получен из email-дайджеста — только название и бюджет. Для полного анализа
                    откройте страницу заказа на Kwork или запустите Computer review.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Why fits */}
          {whyFits.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">Почему подходит</div>
              <div className="space-y-1">
                {whyFits.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-none mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key risks */}
          {keyRisks.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">Ключевые риски</div>
              <div className="space-y-1">
                {keyRisks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-red-500">
                    <X className="w-3.5 h-3.5 flex-none mt-0.5" />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Flags */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Признаки</div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { flag: lead.flagFitsProfile, label: "Fit профиль", positive: true },
                { flag: lead.flagCloudVmFit, label: "Cloud VM", positive: true },
                { flag: lead.flagNeedsCall, label: "Созвон", positive: false },
                { flag: lead.flagNeedsAccess, label: "Доступы", positive: false },
                { flag: lead.flagNeedsDesign, label: "Дизайн", positive: false },
                { flag: lead.flagNeedsMobile, label: "Мобайл", positive: false },
              ].map(({ flag, label, positive }) => (
                <span
                  key={label}
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${
                    flag
                      ? positive
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-red-500/10 text-red-500 border-red-500/20"
                      : "bg-muted/30 text-muted-foreground border-border"
                  }`}
                >
                  {flag ? (positive ? "✓" : "!") : "—"} {label}
                </span>
              ))}
            </div>
          </div>

          {/* Actions row */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              data-testid={`button-open-${lead.id}`}
              size="sm"
              variant="outline"
              onClick={() => openMutation.mutate()}
              disabled={openMutation.isPending}
              className="text-xs"
            >
              {openMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                : <ExternalLink className="w-3.5 h-3.5 mr-1" />
              }
              {lead.orderUrl ? "Открыть заказ" : "Перейти к поиску"}
            </Button>

            <Button
              data-testid={`button-computer-review-${lead.id}`}
              size="sm"
              variant="outline"
              onClick={() => {
                if (!providerOk) {
                  toast({ title: "Провайдер недоступен", description: "Computer review требует LLM. Запустите Ollama / LM Studio.", variant: "default" }); return;
                }
                computerReviewMutation.mutate();
              }}
              disabled={computerReviewMutation.isPending || lead.status === "in_review"}
              className={`text-xs ${!providerOk ? "opacity-60" : ""}`}
              title={!providerOk ? "Провайдер недоступен" : undefined}
            >
              {computerReviewMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                : !providerOk
                ? <AlertCircle className="w-3.5 h-3.5 mr-1 text-amber-500" />
                : <Bot className="w-3.5 h-3.5 mr-1" />
              }
              {lead.status === "in_review" ? "Computer review..." : "Запустить Computer review"}
            </Button>

            {lead.status !== "shortlisted" && lead.isShortlisted === 0 && (
              <Button
                data-testid={`button-add-shortlist-${lead.id}`}
                size="sm"
                variant="outline"
                onClick={() => updateMutation.mutate({ isShortlisted: 1, status: "shortlisted" })}
                className="text-xs"
              >
                <Star className="w-3.5 h-3.5 mr-1" />
                В шортлист
              </Button>
            )}

            {lead.status !== "rejected" && (
              <Button
                data-testid={`button-reject-${lead.id}`}
                size="sm"
                variant="outline"
                onClick={() => updateMutation.mutate({ status: "rejected", isShortlisted: 0 })}
                className="text-xs text-muted-foreground"
              >
                <CircleX className="w-3.5 h-3.5 mr-1" />
                Отклонить
              </Button>
            )}

            <button
              data-testid={`button-delete-${lead.id}`}
              onClick={() => {
                if (confirm("Удалить этот лид?")) deleteMutation.mutate();
              }}
              className="p-1.5 rounded hover:bg-red-500/10 hover:text-red-500 text-muted-foreground transition-colors ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* No URL warning */}
          {!lead.orderUrl && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 border border-border rounded px-3 py-2">
              <Info className="w-3.5 h-3.5 flex-none text-amber-500" />
              Ссылка на заказ отсутствует — лид из email-дайджеста. Для полного ТЗ откройте Kwork вручную или запустите Computer review.
            </div>
          )}

          {/* Response draft */}
          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="text-xs font-medium text-muted-foreground">Черновик отклика</div>
                {!providerOk && (
                  <span className="text-[10px] text-amber-500/80" data-testid={`draft-degraded-${lead.id}`}>— шаблон</span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={generateDraft}
                disabled={draftLoading}
                className="text-xs gap-1.5 h-7"
                data-testid={`button-draft-${lead.id}`}
              >
                {draftLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquarePlus className="w-3 h-3" />}
                {draft ? "Обновить" : "Сгенерировать"}
              </Button>
            </div>
            {!providerOk && !draft && (
              <div className="text-[10px] text-amber-500/70 mb-2 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3 flex-none" />
                Провайдер недоступен — черновик будет сгенерирован по статичному шаблону.
              </div>
            )}
            {draft ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {draftSource === "model" ? (
                    <Badge variant="outline" className="text-[9px] text-purple-400 border-purple-500/30">LLM</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] text-amber-400/70 border-amber-500/20">Шаблон</Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {draftSource === "model" ? "Сгенерирован моделью" : "Шаблонный отклик (LLM недоступен)"}
                  </span>
                </div>
                <div className="bg-muted/20 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap leading-relaxed text-foreground/80 max-h-48 overflow-auto">
                  {draft}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyDraft}
                  className="text-xs gap-1.5 h-7"
                  data-testid={`button-copy-draft-${lead.id}`}
                >
                  <Copy className="w-3 h-3" />
                  Скопировать
                </Button>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Нажмите «Сгенерировать» для черновика отклика.
              </p>
            )}
          </div>

          {/* Computer task link */}
          {lead.computerTaskId && (
            <div className="text-xs text-muted-foreground">
              Linked task: #{lead.computerTaskId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ leads }: { leads: KworkLead[] }) {
  const total = leads.length;
  const strongFit = leads.filter(l => l.recommendation === "strong_fit").length;
  const review = leads.filter(l => l.recommendation === "review_manually").length;
  const rejected = leads.filter(l => l.recommendation === "reject").length;
  const shortlisted = leads.filter(l => l.isShortlisted === 1).length;
  const avgScore = total > 0 ? Math.round(leads.reduce((s, l) => s + l.fitScore, 0) / total) : 0;

  return (
    <div className="grid grid-cols-5 gap-2 text-center">
      {[
        { label: "Всего", value: total, color: "text-foreground" },
        { label: "Strong Fit", value: strongFit, color: "text-emerald-500" },
        { label: "Review", value: review, color: "text-amber-500" },
        { label: "Reject", value: rejected, color: "text-red-500" },
        { label: "Шортлист", value: shortlisted, color: "text-violet-500" },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-lg border border-border bg-card p-2">
          <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type FilterType = "all" | "strong_fit" | "review_manually" | "reject" | "shortlisted" | "new";

export default function KworkLeadsPage() {
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showIntake, setShowIntake] = useState(false);
  const [providerOk, setProviderOk] = useState(false);
  const [providerChecked, setProviderChecked] = useState(false);

  const { data: leads = [], isLoading, refetch } = useQuery<KworkLead[]>({
    queryKey: ["/api/kwork/leads"],
    refetchInterval: 30_000,
  });

  // Silently check provider availability on mount
  const settingsQuery = useQuery<any>({ queryKey: ["/api/settings"] });
  useEffect(() => {
    if (!settingsQuery.data) return;
    const s = settingsQuery.data;
    apiRequest("POST", "/api/providers/check", { providerType: s.providerType || "ollama", baseUrl: s.baseUrl || "http://localhost", port: s.port || 11434 })
      .then(r => r.json())
      .then(d => { setProviderOk(!!d.ok); setProviderChecked(true); })
      .catch(() => { setProviderOk(false); setProviderChecked(true); });
  }, [settingsQuery.data]);

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/kwork/seed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/kwork/leads"] });
      toast({ title: "Demo данные загружены", description: `${data.count} лидов в базе` });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка seed", description: e.message, variant: "destructive" });
    },
  });

  const filteredLeads = leads.filter(lead => {
    const matchFilter =
      filter === "all" ||
      (filter === "shortlisted" && lead.isShortlisted === 1) ||
      (filter === "new" && lead.status === "new") ||
      lead.recommendation === filter;

    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      lead.title.toLowerCase().includes(q) ||
      lead.category.toLowerCase().includes(q) ||
      lead.brief.toLowerCase().includes(q);

    return matchFilter && matchSearch;
  });

  // Sort: shortlisted first, then by fitScore desc
  const sortedLeads = [...filteredLeads].sort((a, b) => {
    if (a.isShortlisted !== b.isShortlisted) return b.isShortlisted - a.isShortlisted;
    return b.fitScore - a.fitScore;
  });

  const filterOptions: { value: FilterType; label: string; count: number }[] = [
    { value: "all", label: "Все", count: leads.length },
    { value: "strong_fit", label: "Strong Fit", count: leads.filter(l => l.recommendation === "strong_fit").length },
    { value: "review_manually", label: "Review", count: leads.filter(l => l.recommendation === "review_manually").length },
    { value: "reject", label: "Reject", count: leads.filter(l => l.recommendation === "reject").length },
    { value: "shortlisted", label: "Шортлист", count: leads.filter(l => l.isShortlisted === 1).length },
    { value: "new", label: "Новые", count: leads.filter(l => l.status === "new").length },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/">
            <button className="p-1.5 rounded-md hover:bg-muted transition-colors" data-testid="button-back">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </button>
          </Link>

          {/* Logo */}
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-primary" aria-label="Kwork Scoring">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 12 L11 15 L16 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="4" r="1.5" fill="currentColor" opacity="0.4" />
            </svg>
            <div>
              <div className="text-sm font-semibold leading-tight">Kwork Leads</div>
              <div className="text-xs text-muted-foreground leading-tight">Scoring workflow</div>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            {leads.length === 0 && (
              <Button
                data-testid="button-seed"
                size="sm"
                variant="outline"
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                className="text-xs"
              >
                {seedMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  : <Database className="w-3.5 h-3.5 mr-1" />
                }
                Загрузить demo
              </Button>
            )}

            <Button
              data-testid="button-add-lead"
              size="sm"
              onClick={() => setShowIntake(true)}
              className="text-xs"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Добавить лид
            </Button>

            <button
              data-testid="button-refresh"
              onClick={() => refetch()}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
            >
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Stats */}
        {leads.length > 0 && <StatsBar leads={leads} />}

        {/* Provider status banner */}
        {providerChecked && !providerOk && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-500/90" data-testid="provider-offline-banner">
            <AlertCircle className="w-3.5 h-3.5 flex-none" />
            <span>
              <span className="font-semibold">Деградированный режим</span> — провайдер LLM недоступен.
              { }Computer review и генерация отклика будут работать в режиме шаблона.
              { }<Link href="/settings"><span className="underline cursor-pointer">Настройки провайдера</span></Link>.
            </span>
          </div>
        )}

        {/* Filters + Search */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex gap-1 flex-wrap">
            {filterOptions.map(opt => (
              <button
                key={opt.value}
                data-testid={`filter-${opt.value}`}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                  filter === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                }`}
              >
                {opt.label} {opt.count > 0 && <span className="ml-1 opacity-70">{opt.count}</span>}
              </button>
            ))}
          </div>
          <div className="flex-1">
            <Input
              data-testid="input-search"
              placeholder="Поиск по названию, категории, ТЗ..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="text-sm"
            />
          </div>
        </div>

        {/* Lead list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Загрузка лидов...
          </div>
        ) : sortedLeads.length === 0 ? (
          <div className="text-center py-16">
            <Layers className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            {leads.length === 0 ? (
              <div>
                <div className="text-muted-foreground mb-4">Нет лидов. Загрузите demo-данные или добавьте первый лид.</div>
                <Button
                  data-testid="button-seed-empty"
                  variant="outline"
                  onClick={() => seedMutation.mutate()}
                  disabled={seedMutation.isPending}
                >
                  {seedMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Database className="w-4 h-4 mr-1" />}
                  Загрузить demo данные
                </Button>
              </div>
            ) : (
              <div className="text-muted-foreground">Ничего не найдено по текущему фильтру</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedLeads.map(lead => (
              <LeadCard key={lead.id} lead={lead} onUpdate={() => {}} providerOk={providerOk} />
            ))}
          </div>
        )}

        {/* Info banner */}
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1">Как работает Kwork Scoring</div>
          <ul className="space-y-0.5 list-disc list-inside">
            <li>Бюджет &lt; 50 000 ₽ → автоматически Reject</li>
            <li>Бюджет ≥ 50 000 ₽ → базовый фильтр пройден, далее анализ по стеку</li>
            <li>Бонусы: AI/LLM, browser automation, Telegram, интеграции, cloud/VPS</li>
            <li>Штрафы: расплывчатое ТЗ, мобильный стек, обязательный созвон, дизайн</li>
            <li>Strong Fit ≥ 70 / Review Manually 40–69 / Reject &lt; 40</li>
            <li>Лиды из email-дайджеста — без полного ТЗ: для полного анализа нужна страница заказа</li>
          </ul>
        </div>
      </main>

      {/* Intake dialog */}
      <Dialog open={showIntake} onOpenChange={setShowIntake}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Добавить Kwork лид</DialogTitle>
            <DialogDescription>
              Введите данные проекта — scoring будет выполнен автоматически.
            </DialogDescription>
          </DialogHeader>
          <IntakeForm
            onClose={() => setShowIntake(false)}
            onCreated={() => setShowIntake(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
