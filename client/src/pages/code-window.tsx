/**
 * Code Window — full-screen IDE-style code workflow page.
 *
 * Route: /#/code?q=<user query>
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Top bar: back · logo · status badge · theme toggle      │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  Query bar: input + [Сгенерировать]                      │
 *   ├───────────────────────┬─────────────────────────────────┤
 *   │                       │                                  │
 *   │   LEFT: Monaco IDE    │   RIGHT: Output / Debug / Info   │
 *   │   lang tabs           │   tabbed panel                   │
 *   │   action toolbar      │                                  │
 *   │                       │                                  │
 *   └───────────────────────┴─────────────────────────────────┘
 *
 * Actions:
 *   • Сгенерировать — LLM generates new code from query
 *   • Правки        — LLM refines current code via diff-prompt
 *   • Запустить     — runs current code in sandbox
 *   • Дебаг         — runs code + asks LLM to explain errors
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  Terminal,
  Zap,
  Code2,
  Bug,
  PenLine,
  Info,
  Sun,
  Moon,
  RefreshCw,
  Clock,
  Hash,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import MonacoEditorWrapper, { type EditorLang } from "@/components/monaco-editor-wrapper";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | "idle"
  | "generating"
  | "patching"
  | "running"
  | "debugging"
  | "done"
  | "error";

type Lang = EditorLang;

interface RunResult {
  output: string;
  error: string;
  exitCode: number | null;
  durationMs: number;
  language: string;
}

interface DebugResult {
  explanation: string;
  suggestedFix?: string;
  fixedCode?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getQueryParam(search: string, key: string): string {
  const idx = search.indexOf("?");
  if (idx === -1) return "";
  const params = new URLSearchParams(search.slice(idx + 1));
  return params.get(key) ?? "";
}

const LANG_LABELS: Record<Lang, string> = {
  python: "Python",
  javascript: "JavaScript",
  bash: "Bash",
};

const LANG_EXT: Record<Lang, string> = {
  python: ".py",
  javascript: ".js",
  bash: ".sh",
};

const LANG_COMMENT: Record<Lang, string> = {
  python: "#",
  javascript: "//",
  bash: "#",
};

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({
  phase,
  exitCode,
}: {
  phase: Phase;
  exitCode?: number | null;
}) {
  const badges: Record<Phase, React.ReactNode> = {
    idle: (
      <Badge variant="secondary" className="text-[11px] gap-1">
        <Code2 className="h-3 w-3" /> Готов
      </Badge>
    ),
    generating: (
      <Badge className="text-[11px] gap-1 bg-purple-500/20 text-purple-400 border-purple-500/30">
        <Loader2 className="h-3 w-3 animate-spin" /> Генерация…
      </Badge>
    ),
    patching: (
      <Badge className="text-[11px] gap-1 bg-amber-500/20 text-amber-400 border-amber-500/30">
        <Loader2 className="h-3 w-3 animate-spin" /> Правки…
      </Badge>
    ),
    running: (
      <Badge className="text-[11px] gap-1 bg-blue-500/20 text-blue-400 border-blue-500/30">
        <Loader2 className="h-3 w-3 animate-spin" /> Выполнение…
      </Badge>
    ),
    debugging: (
      <Badge className="text-[11px] gap-1 bg-orange-500/20 text-orange-400 border-orange-500/30">
        <Loader2 className="h-3 w-3 animate-spin" /> Дебаг…
      </Badge>
    ),
    done: (
      <Badge
        className={`text-[11px] gap-1 ${
          exitCode === 0
            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
            : "bg-red-500/20 text-red-400 border-red-500/30"
        }`}
      >
        {exitCode === 0 ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <XCircle className="h-3 w-3" />
        )}
        {exitCode === 0 ? "Выполнено" : `Ошибка (exit ${exitCode})`}
      </Badge>
    ),
    error: (
      <Badge className="text-[11px] gap-1 bg-red-500/20 text-red-400 border-red-500/30">
        <AlertTriangle className="h-3 w-3" /> Ошибка генерации
      </Badge>
    ),
  };
  return <>{badges[phase]}</>;
}

// ── Output Panel ──────────────────────────────────────────────────────────────

function OutputTab({
  phase,
  result,
}: {
  phase: Phase;
  result: RunResult | null;
}) {
  if (phase === "generating" || phase === "patching") {
    return (
      <PanelSpinner
        color="text-purple-400/70"
        label={phase === "patching" ? "Применяются правки…" : "Генерируется код…"}
        testId="output-generating"
      />
    );
  }
  if (phase === "running") {
    return (
      <PanelSpinner
        color="text-blue-400/70"
        label="Выполняется код…"
        testId="output-running"
      />
    );
  }
  if (phase === "debugging") {
    return (
      <PanelSpinner
        color="text-orange-400/70"
        label="Анализ ошибок…"
        testId="output-debugging"
      />
    );
  }
  if (!result) {
    return (
      <div
        className="h-full flex items-center justify-center text-muted-foreground/40 text-sm"
        data-testid="output-empty"
      >
        {phase === "error"
          ? "Генерация кода не удалась."
          : "Нажмите «Запустить» для выполнения."}
      </div>
    );
  }

  const hasOutput = result.output.trim().length > 0;
  const hasError = result.error.trim().length > 0;
  const isOk = result.exitCode === 0;

  return (
    <div className="h-full flex flex-col" data-testid="output-panel">
      {/* Meta bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border/50 shrink-0 bg-card/30">
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono ${
            isOk
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-red-500/15 text-red-400"
          }`}
          data-testid="output-exit-code"
        >
          exit {result.exitCode ?? "?"}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground text-[11px] font-mono">
          <Clock className="h-3 w-3" />
          {result.durationMs}ms
        </span>
        <span className="flex items-center gap-1 text-muted-foreground text-[11px] capitalize font-mono">
          <Hash className="h-3 w-3" />
          {result.language}
        </span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4 font-mono text-[12.5px]">
          {hasOutput && (
            <div>
              <div className="text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-2 font-sans">
                stdout
              </div>
              <pre
                className="text-emerald-400/90 whitespace-pre-wrap break-all leading-relaxed"
                data-testid="output-stdout"
              >
                {result.output}
              </pre>
            </div>
          )}
          {hasError && (
            <div>
              <div className="text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-2 font-sans">
                stderr
              </div>
              <pre
                className="text-red-400/90 whitespace-pre-wrap break-all leading-relaxed"
                data-testid="output-stderr"
              >
                {result.error}
              </pre>
            </div>
          )}
          {!hasOutput && !hasError && (
            <p className="text-muted-foreground/40 italic font-sans text-sm">
              Нет вывода
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Debug Panel ───────────────────────────────────────────────────────────────

function DebugTab({
  phase,
  result,
  debugResult,
  onApplyFix,
}: {
  phase: Phase;
  result: RunResult | null;
  debugResult: DebugResult | null;
  onApplyFix: (code: string) => void;
}) {
  if (phase === "debugging") {
    return (
      <PanelSpinner
        color="text-orange-400/70"
        label="LLM анализирует ошибки…"
        testId="debug-loading"
      />
    );
  }

  if (!debugResult) {
    const noError = !result || result.exitCode === 0;
    return (
      <div
        className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/40 text-sm px-6 text-center"
        data-testid="debug-empty"
      >
        <Bug className="h-8 w-8 mb-1 opacity-30" />
        {noError
          ? "Код выполнен успешно — ошибок нет."
          : "Нажмите «Дебаг» для анализа ошибок."}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full" data-testid="debug-panel">
      <div className="p-4 space-y-4">
        {/* Explanation */}
        <div>
          <div className="text-[10px] text-orange-400/70 uppercase tracking-widest mb-2 font-sans">
            Анализ
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {debugResult.explanation}
          </p>
        </div>

        {/* Suggested fix prose */}
        {debugResult.suggestedFix && (
          <div>
            <div className="text-[10px] text-amber-400/70 uppercase tracking-widest mb-2 font-sans">
              Предложение
            </div>
            <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">
              {debugResult.suggestedFix}
            </p>
          </div>
        )}

        {/* Fixed code */}
        {debugResult.fixedCode && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-emerald-400/70 uppercase tracking-widest font-sans">
                Исправленный код
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2 gap-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                onClick={() => onApplyFix(debugResult.fixedCode!)}
                data-testid="button-apply-fix"
              >
                <CheckCircle2 className="h-3 w-3" />
                Применить
              </Button>
            </div>
            <pre className="font-mono text-[12px] text-foreground/80 bg-black/25 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              {debugResult.fixedCode}
            </pre>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// ── Info Panel ────────────────────────────────────────────────────────────────

function InfoTab({
  lang,
  code,
  userQuery,
  sessionId,
}: {
  lang: Lang;
  code: string;
  userQuery: string;
  sessionId: string;
}) {
  const lineCount = code ? code.split("\n").length : 0;
  const charCount = code.length;

  return (
    <ScrollArea className="h-full" data-testid="info-panel">
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="text-[10px] text-muted-foreground/50 uppercase tracking-widest font-sans">
            Сессия
          </div>
          <div className="font-mono text-[12px] text-muted-foreground/70 bg-muted/20 rounded px-2 py-1.5 break-all">
            {sessionId}
          </div>
        </div>

        {userQuery && (
          <div className="space-y-2">
            <div className="text-[10px] text-muted-foreground/50 uppercase tracking-widest font-sans">
              Запрос
            </div>
            <p className="text-sm text-foreground/70 leading-relaxed">
              {userQuery}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[10px] text-muted-foreground/50 uppercase tracking-widest font-sans">
            Файл
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="font-mono text-[12px] text-primary/80 bg-primary/10 rounded px-2 py-1">
              main{LANG_EXT[lang]}
            </span>
            <span className="font-mono text-[12px] text-muted-foreground/60 bg-muted/20 rounded px-2 py-1">
              {lineCount} строк
            </span>
            <span className="font-mono text-[12px] text-muted-foreground/60 bg-muted/20 rounded px-2 py-1">
              {charCount} символов
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] text-muted-foreground/50 uppercase tracking-widest font-sans">
            Язык
          </div>
          <div className="flex gap-2 flex-wrap">
            {(["python", "javascript", "bash"] as Lang[]).map((l) => (
              <span
                key={l}
                className={`font-mono text-[12px] rounded px-2 py-1 ${
                  l === lang
                    ? "text-primary bg-primary/15"
                    : "text-muted-foreground/50 bg-muted/10"
                }`}
              >
                {LANG_LABELS[l]}
              </span>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground/30 border-t border-border/40 pt-3 font-mono">
          Local Comet IDE • v2
        </div>
      </div>
    </ScrollArea>
  );
}

// ── Shared Spinner ────────────────────────────────────────────────────────────

function PanelSpinner({
  color,
  label,
  testId,
}: {
  color: string;
  label: string;
  testId?: string;
}) {
  return (
    <div
      className="h-full flex items-center justify-center gap-3 text-muted-foreground/60"
      data-testid={testId}
    >
      <Loader2 className={`h-5 w-5 animate-spin ${color}`} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

// ── Main Code Window Page ─────────────────────────────────────────────────────

export default function CodeWindowPage() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  // Parse query
  const rawSearch = typeof window !== "undefined" ? window.location.search : "";
  const rawHash = typeof window !== "undefined" ? window.location.hash : "";
  const initialQuery = decodeURIComponent(
    getQueryParam(rawSearch, "q") || getQueryParam(rawHash, "q")
  );

  const [userQuery, setUserQuery] = useState(initialQuery);
  const [patchQuery, setPatchQuery] = useState("");
  const [showPatchBar, setShowPatchBar] = useState(false);
  const [lang, setLang] = useState<Lang>("python");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [debugResult, setDebugResult] = useState<DebugResult | null>(null);
  const [sessionId] = useState(() => `cw-${Date.now()}`);
  const [copied, setCopied] = useState(false);
  const [rightTab, setRightTab] = useState<"output" | "debug" | "info">(
    "output"
  );

  const isWorking =
    phase === "generating" ||
    phase === "patching" ||
    phase === "running" ||
    phase === "debugging";

  // ── Generate + run ──────────────────────────────────────────────────────────
  const generateAndRun = useCallback(
    async (query: string, overrideLang?: Lang) => {
      if (!query.trim()) return;

      setPhase("generating");
      setResult(null);
      setDebugResult(null);
      setRightTab("output");
      setCode(
        `${LANG_COMMENT[overrideLang ?? lang]} Генерация кода для: ${query}\n${LANG_COMMENT[overrideLang ?? lang]} Пожалуйста, подождите…`
      );

      try {
        const res = await apiRequest("POST", "/api/computer/code", {
          query,
          sessionId,
          language: overrideLang ?? lang,
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          const errMsg = data.error || `Ошибка ${res.status}`;
          setCode(
            `${LANG_COMMENT[overrideLang ?? lang]} Ошибка генерации: ${errMsg}`
          );
          setPhase("error");
          return;
        }

        const detectedLang = (
          data.language === "typescript"
            ? "javascript"
            : (data.language ?? (overrideLang ?? lang))
        ) as Lang;
        setLang(detectedLang);
        setCode(data.code || "");

        if (data.sandbox) {
          setPhase("done");
          setResult({
            output: data.sandbox.output ?? data.sandbox.stdout ?? "",
            error: data.sandbox.error ?? data.sandbox.stderr ?? "",
            exitCode: data.sandbox.exitCode ?? null,
            durationMs: data.sandbox.durationMs ?? 0,
            language: data.language ?? detectedLang,
          });
        } else {
          setPhase("running");
          await runCode(data.code, detectedLang);
        }
      } catch (err: any) {
        setCode(
          `${LANG_COMMENT[overrideLang ?? lang]} Ошибка: ${err.message}`
        );
        setPhase("error");
      }
    },
    [lang, sessionId]
  );

  // ── Patch (Правки) — refine existing code ──────────────────────────────────
  const applyPatch = useCallback(
    async (instructions: string) => {
      if (!instructions.trim() || !code.trim()) return;

      setPhase("patching");
      setResult(null);
      setDebugResult(null);
      setRightTab("output");

      // Build a prompt asking LLM to refine current code
      const patchPrompt = `Вот текущий ${LANG_LABELS[lang]} код:\n\`\`\`\n${code}\n\`\`\`\n\nВнеси следующие правки: ${instructions}\n\nВерни только готовый исправленный код без пояснений.`;

      try {
        const res = await apiRequest("POST", "/api/computer/code", {
          query: patchPrompt,
          sessionId,
          language: lang,
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          setPhase("error");
          return;
        }

        const newCode = data.code || code;
        setCode(newCode);

        if (data.sandbox) {
          setPhase("done");
          setResult({
            output: data.sandbox.output ?? data.sandbox.stdout ?? "",
            error: data.sandbox.error ?? data.sandbox.stderr ?? "",
            exitCode: data.sandbox.exitCode ?? null,
            durationMs: data.sandbox.durationMs ?? 0,
            language: lang,
          });
        } else {
          setPhase("running");
          await runCode(newCode, lang);
        }
        setShowPatchBar(false);
        setPatchQuery("");
      } catch (err: any) {
        setPhase("error");
      }
    },
    [code, lang, sessionId]
  );

  // ── Run code ────────────────────────────────────────────────────────────────
  const runCode = useCallback(
    async (codeToRun?: string, forceLang?: Lang) => {
      const src = codeToRun ?? code;
      const langToUse = forceLang ?? lang;
      if (!src.trim()) return;

      setPhase("running");
      setResult(null);
      setDebugResult(null);
      setRightTab("output");

      try {
        const res = await apiRequest("POST", "/api/sandbox/run", {
          code: src,
          language: langToUse,
          sessionId,
          timeout: 15000,
        });
        const data = await res.json();

        const runResult: RunResult = res.ok
          ? {
              output: data.output ?? data.stdout ?? "",
              error: data.error ?? data.stderr ?? "",
              exitCode: data.exitCode ?? null,
              durationMs: data.durationMs ?? 0,
              language: data.language ?? langToUse,
            }
          : {
              output: "",
              error: data.error || `Ошибка сервера: ${res.status}`,
              exitCode: 1,
              durationMs: 0,
              language: langToUse,
            };

        setResult(runResult);
        setPhase("done");
      } catch (err: any) {
        setResult({
          output: "",
          error: `Ошибка выполнения: ${err.message}`,
          exitCode: 1,
          durationMs: 0,
          language: langToUse,
        });
        setPhase("done");
      }
    },
    [code, lang, sessionId]
  );

  // ── Debug — run + LLM explain errors ────────────────────────────────────────
  const debugCode = useCallback(async () => {
    if (!code.trim()) return;

    setPhase("debugging");
    setDebugResult(null);
    setRightTab("debug");

    let runRes: RunResult | null = null;

    // First run the code to get fresh results
    try {
      const res = await apiRequest("POST", "/api/sandbox/run", {
        code,
        language: lang,
        sessionId,
        timeout: 15000,
      });
      const data = await res.json();
      runRes = {
        output: data.output ?? data.stdout ?? "",
        error: data.error ?? data.stderr ?? "",
        exitCode: data.exitCode ?? null,
        durationMs: data.durationMs ?? 0,
        language: data.language ?? lang,
      };
      setResult(runRes);
    } catch (err: any) {
      runRes = {
        output: "",
        error: `Ошибка выполнения: ${(err as any).message}`,
        exitCode: 1,
        durationMs: 0,
        language: lang,
      };
      setResult(runRes);
    }

    // Then ask LLM to explain + suggest fix
    const hasError =
      (runRes.error && runRes.error.trim().length > 0) ||
      (runRes.exitCode !== null && runRes.exitCode !== 0);

    if (!hasError) {
      // No error — nothing to debug
      setDebugResult({
        explanation: "Код выполнен без ошибок. Нет проблем для анализа.",
      });
      setPhase("done");
      return;
    }

    const debugPrompt = `Проанализируй следующую ошибку в ${LANG_LABELS[lang]} коде.\n\nКод:\n\`\`\`\n${code}\n\`\`\`\n\nStdout:\n${runRes.output || "(пусто)"}\n\nStderr / ошибка:\n${runRes.error || "(пусто)"}\n\nExit code: ${runRes.exitCode}\n\nОтветь в формате JSON:\n{\n  "explanation": "...",\n  "suggestedFix": "...",\n  "fixedCode": "..."\n}\n\nGive only the JSON without code blocks.`;

    try {
      const res = await apiRequest("POST", "/api/computer/code", {
        query: debugPrompt,
        sessionId,
        language: lang,
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        // Try to parse JSON from LLM response
        let rawText = data.code || data.response || "";
        // strip potential markdown fences
        rawText = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        try {
          const parsed = JSON.parse(rawText);
          setDebugResult({
            explanation: parsed.explanation || rawText,
            suggestedFix: parsed.suggestedFix,
            fixedCode: parsed.fixedCode,
          });
        } catch {
          setDebugResult({ explanation: rawText });
        }
      } else {
        setDebugResult({
          explanation: "Не удалось получить анализ ошибки от LLM.",
        });
      }
    } catch (err: any) {
      setDebugResult({
        explanation: `Ошибка запроса к LLM: ${err.message}`,
      });
    }

    setPhase("done");
  }, [code, lang, sessionId]);

  // ── Auto-generate on mount ──────────────────────────────────────────────────
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initialQuery.trim()) {
      const lower = initialQuery.toLowerCase();
      let detectedLang: Lang = "python";
      if (/\btypescript\b|\bts\b/.test(lower)) detectedLang = "javascript";
      else if (/\bjavascript\b|\bjs\b|\bnode\.?js\b/.test(lower))
        detectedLang = "javascript";
      else if (/\bbash\b|\bshell\b/.test(lower)) detectedLang = "bash";
      setLang(detectedLang);
      generateAndRun(initialQuery, detectedLang);
    }
  }, []); // eslint-disable-line

  // ── Copy code ───────────────────────────────────────────────────────────────
  const handleCopy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── Apply debug fix ─────────────────────────────────────────────────────────
  const handleApplyFix = useCallback((fixedCode: string) => {
    setCode(fixedCode);
    setRightTab("output");
    setDebugResult(null);
    setResult(null);
    setPhase("idle");
  }, []);

  return (
    <div
      className="h-screen flex flex-col bg-background text-foreground overflow-hidden"
      data-testid="code-window"
    >
      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card/50">
        <Link href="/">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            data-testid="button-back-to-control"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Назад
          </Button>
        </Link>

        <div className="w-px h-5 bg-border mx-0.5 shrink-0" />

        {/* Logo */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
            <Zap className="h-3 w-3 text-primary" />
          </div>
          <span className="text-[12px] font-semibold text-foreground/80 hidden sm:block">
            Code IDE
          </span>
        </div>

        {/* Status badge */}
        <div className="flex-1 flex items-center gap-2 min-w-0 ml-1">
          <StatusBadge phase={phase} exitCode={result?.exitCode} />
          {userQuery && (
            <span
              className="text-[11px] text-muted-foreground truncate hidden md:block max-w-xs"
              title={userQuery}
              data-testid="text-user-query"
            >
              {userQuery}
            </span>
          )}
        </div>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0"
          onClick={toggleTheme}
          data-testid="button-toggle-theme"
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* ── Query Bar ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card/30 px-3 py-2 flex items-center gap-2">
        <Terminal className="h-4 w-4 text-muted-foreground/60 shrink-0" />
        <input
          type="text"
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isWorking) {
              generateAndRun(userQuery);
            }
          }}
          placeholder="Опишите задачу…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40 text-foreground"
          data-testid="input-code-query"
        />
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5 shrink-0 bg-primary hover:bg-primary/90"
          disabled={isWorking || !userQuery.trim()}
          onClick={() => generateAndRun(userQuery)}
          data-testid="button-generate"
        >
          {phase === "generating" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          Сгенерировать
        </Button>
      </div>

      {/* ── Patch Bar (shown when Правки is clicked) ─────────────────────────── */}
      {showPatchBar && (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 flex items-center gap-2">
          <PenLine className="h-4 w-4 text-amber-400/70 shrink-0" />
          <input
            type="text"
            value={patchQuery}
            onChange={(e) => setPatchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isWorking) applyPatch(patchQuery);
              if (e.key === "Escape") {
                setShowPatchBar(false);
                setPatchQuery("");
              }
            }}
            placeholder="Опишите правки для кода…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-amber-400/30 text-foreground"
            autoFocus
            data-testid="input-patch-query"
          />
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5 shrink-0 bg-amber-600 hover:bg-amber-500 text-white border-0"
            disabled={isWorking || !patchQuery.trim() || !code.trim()}
            onClick={() => applyPatch(patchQuery)}
            data-testid="button-apply-patch"
          >
            {phase === "patching" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Применить
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => {
              setShowPatchBar(false);
              setPatchQuery("");
            }}
          >
            Отмена
          </Button>
        </div>
      )}

      {/* ── Main Split ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── LEFT: Code Editor ──────────────────────────────────────────────── */}
        <div className="flex flex-col min-h-0 border-r border-border" style={{ width: "55%" }}>

          {/* Editor toolbar */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/60 shrink-0 bg-card/20">
            {/* Language tabs */}
            <div className="flex gap-0.5 mr-2">
              {(["python", "javascript", "bash"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    if (l !== lang && !isWorking) {
                      setLang(l);
                      setCode("");
                      setResult(null);
                      setDebugResult(null);
                      setPhase("idle");
                    }
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
                    lang === l
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                  }`}
                  data-testid={`button-lang-${l}`}
                >
                  {LANG_LABELS[l]}
                </button>
              ))}
            </div>

            {code && (
              <span className="text-[10px] font-mono text-muted-foreground/40 mr-auto">
                main{LANG_EXT[lang]}
              </span>
            )}
            {!code && <div className="flex-1" />}

            {/* Copy */}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2 gap-1 text-muted-foreground"
              onClick={handleCopy}
              disabled={!code}
              data-testid="button-copy-code"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Скопировано!" : "Копировать"}
            </Button>

            {/* ── Action Buttons ── */}
            <div className="flex items-center gap-1 ml-1 border-l border-border/50 pl-2">
              {/* Правки */}
              <Button
                variant="ghost"
                size="sm"
                className={`h-6 text-[10px] px-2.5 gap-1 transition-colors ${
                  showPatchBar
                    ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/20"
                    : "text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10"
                }`}
                disabled={isWorking || !code.trim()}
                onClick={() => {
                  setShowPatchBar((v) => !v);
                  if (showPatchBar) setPatchQuery("");
                }}
                data-testid="button-patch"
              >
                <PenLine className="h-3 w-3" />
                Правки
              </Button>

              {/* Запустить */}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2.5 gap-1 text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10"
                onClick={() => runCode()}
                disabled={isWorking || !code.trim()}
                data-testid="button-run"
              >
                {phase === "running" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                Запустить
              </Button>

              {/* Дебаг */}
              <Button
                size="sm"
                className="h-6 text-[10px] px-2.5 gap-1 bg-orange-600/80 hover:bg-orange-500 text-white border-0"
                onClick={debugCode}
                disabled={isWorking || !code.trim()}
                data-testid="button-debug"
              >
                {phase === "debugging" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Bug className="h-3 w-3" />
                )}
                Дебаг
              </Button>
            </div>
          </div>

          {/* Monaco Editor */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <MonacoEditorWrapper
              value={code}
              onChange={setCode}
              language={lang}
              placeholder={`${LANG_COMMENT[lang]} Код появится здесь после генерации…`}
              testId="monaco-code-editor"
            />
          </div>
        </div>

        {/* ── RIGHT: Tabbed Panel ─────────────────────────────────────────────── */}
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ width: "45%" }}>
          <Tabs
            value={rightTab}
            onValueChange={(v) => setRightTab(v as typeof rightTab)}
            className="flex flex-col h-full"
          >
            {/* Tab header */}
            <div className="shrink-0 border-b border-border/60 bg-card/20 px-3 py-1.5 flex items-center gap-1">
              <TabsList className="h-6 p-0.5 bg-muted/30 gap-0.5">
                <TabsTrigger
                  value="output"
                  className="h-5 px-2.5 text-[11px] gap-1 data-[state=active]:bg-background data-[state=active]:text-foreground"
                  data-testid="tab-output"
                >
                  <Terminal className="h-3 w-3" />
                  Вывод
                  {result && (
                    <span
                      className={`ml-0.5 w-1.5 h-1.5 rounded-full ${
                        result.exitCode === 0
                          ? "bg-emerald-400"
                          : "bg-red-400"
                      }`}
                    />
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="debug"
                  className="h-5 px-2.5 text-[11px] gap-1 data-[state=active]:bg-background data-[state=active]:text-foreground"
                  data-testid="tab-debug"
                >
                  <Bug className="h-3 w-3" />
                  Дебаг
                  {debugResult && (
                    <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-orange-400" />
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="info"
                  className="h-5 px-2.5 text-[11px] gap-1 data-[state=active]:bg-background data-[state=active]:text-foreground"
                  data-testid="tab-info"
                >
                  <Info className="h-3 w-3" />
                  Инфо
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <TabsContent
                value="output"
                className="h-full m-0 data-[state=inactive]:hidden"
              >
                <OutputTab phase={phase} result={result} />
              </TabsContent>
              <TabsContent
                value="debug"
                className="h-full m-0 data-[state=inactive]:hidden"
              >
                <DebugTab
                  phase={phase}
                  result={result}
                  debugResult={debugResult}
                  onApplyFix={handleApplyFix}
                />
              </TabsContent>
              <TabsContent
                value="info"
                className="h-full m-0 data-[state=inactive]:hidden"
              >
                <InfoTab
                  lang={lang}
                  code={code}
                  userQuery={userQuery}
                  sessionId={sessionId}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
