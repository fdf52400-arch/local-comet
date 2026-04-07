/**
 * Code Window — dedicated full-screen code-first workflow page.
 *
 * Route: /#/code?q=<user query>
 *
 * Flow:
 *  1. User arrives with ?q= from control-center (code_task intent)
 *  2. On mount, POST /api/computer/code → LLM generates code
 *  3. Code is shown in an editable code block immediately
 *  4. Server auto-runs the code in the sandbox
 *  5. stdout / stderr / exit code are shown right below
 *
 * User can also:
 *  - Edit the code and re-run manually
 *  - Change language and start fresh
 *  - Return to control-center via the back button
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  RotateCcw,
  Terminal,
  Zap,
  Code2,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Sun, Moon } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | "idle"
  | "generating"
  | "running"
  | "done"
  | "error";

type Lang = "python" | "javascript" | "bash";

interface RunResult {
  output: string;
  error: string;
  exitCode: number | null;
  durationMs: number;
  language: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getQueryParam(search: string, key: string): string {
  // wouter passes the full hash including ?q=..., so we parse manually
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

function StatusBadge({ phase, exitCode }: { phase: Phase; exitCode?: number | null }) {
  if (phase === "idle") {
    return (
      <Badge variant="secondary" className="text-[11px] gap-1">
        <Code2 className="h-3 w-3" /> Готов
      </Badge>
    );
  }
  if (phase === "generating") {
    return (
      <Badge className="text-[11px] gap-1 bg-purple-500/20 text-purple-400 border-purple-500/30">
        <Loader2 className="h-3 w-3 animate-spin" /> Генерация кода…
      </Badge>
    );
  }
  if (phase === "running") {
    return (
      <Badge className="text-[11px] gap-1 bg-blue-500/20 text-blue-400 border-blue-500/30">
        <Loader2 className="h-3 w-3 animate-spin" /> Выполнение…
      </Badge>
    );
  }
  if (phase === "done") {
    const ok = exitCode === 0;
    return (
      <Badge
        className={`text-[11px] gap-1 ${
          ok
            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
            : "bg-red-500/20 text-red-400 border-red-500/30"
        }`}
      >
        {ok ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <XCircle className="h-3 w-3" />
        )}
        {ok ? "Выполнено" : `Ошибка (exit ${exitCode})`}
      </Badge>
    );
  }
  if (phase === "error") {
    return (
      <Badge className="text-[11px] gap-1 bg-red-500/20 text-red-400 border-red-500/30">
        <AlertTriangle className="h-3 w-3" /> Ошибка генерации
      </Badge>
    );
  }
  return null;
}

// ── Output Panel ──────────────────────────────────────────────────────────────

function OutputPanel({
  phase,
  result,
}: {
  phase: Phase;
  result: RunResult | null;
}) {
  if (phase === "generating") {
    return (
      <div
        className="h-full flex items-center justify-center gap-3 text-muted-foreground/60"
        data-testid="output-generating"
      >
        <Loader2 className="h-5 w-5 animate-spin text-purple-400/70" />
        <span className="text-sm">Генерируется код…</span>
      </div>
    );
  }
  if (phase === "running") {
    return (
      <div
        className="h-full flex items-center justify-center gap-3 text-muted-foreground/60"
        data-testid="output-running"
      >
        <Loader2 className="h-5 w-5 animate-spin text-blue-400/70" />
        <span className="text-sm">Выполняется…</span>
      </div>
    );
  }
  if (!result && (phase === "idle" || phase === "error")) {
    return (
      <div
        className="h-full flex items-center justify-center text-muted-foreground/40 text-sm"
        data-testid="output-empty"
      >
        {phase === "error"
          ? "Генерация кода не удалась."
          : "Нажмите «Запустить» для выполнения кода."}
      </div>
    );
  }
  if (!result) return null;

  const hasOutput = result.output.trim().length > 0;
  const hasError = result.error.trim().length > 0;
  const isOk = result.exitCode === 0;

  return (
    <div
      className="h-full flex flex-col font-mono text-[13px]"
      data-testid="output-panel"
    >
      {/* Meta bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 shrink-0">
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
            isOk
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-red-500/15 text-red-400"
          }`}
          data-testid="output-exit-code"
        >
          exit {result.exitCode ?? "?"}
        </span>
        <span className="text-muted-foreground text-[11px]">
          {result.durationMs}ms
        </span>
        <span className="text-muted-foreground text-[11px] capitalize">
          {result.language}
        </span>
      </div>

      {/* Output body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-3">
          {hasOutput && (
            <div>
              <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide mb-1.5 font-sans">
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
              <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide mb-1.5 font-sans">
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

// ── Main Code Window Page ─────────────────────────────────────────────────────

export default function CodeWindowPage() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  // Parse query from URL.
  // When wouter's navigate('/code?q=...') is called, the query goes into
  // location.search (outside the hash). Playwright direct navigation may put
  // it inside the hash. We check both.
  const rawSearch = typeof window !== "undefined" ? window.location.search : "";
  const rawHash = typeof window !== "undefined" ? window.location.hash : "";
  const initialQuery = decodeURIComponent(
    getQueryParam(rawSearch, "q") || getQueryParam(rawHash, "q")
  );

  const [userQuery, setUserQuery] = useState(initialQuery);
  const [lang, setLang] = useState<Lang>("python");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [sessionId] = useState(() => `cw-${Date.now()}`);
  const [copied, setCopied] = useState(false);

  // Generate + run via /api/computer/code
  const generateAndRun = useCallback(
    async (query: string, overrideLang?: Lang) => {
      if (!query.trim()) return;

      setPhase("generating");
      setResult(null);
      setCode(`${LANG_COMMENT[overrideLang ?? lang]} Генерация кода для: ${query}\n${LANG_COMMENT[overrideLang ?? lang]} Пожалуйста, подождите…`);

      try {
        const res = await apiRequest("POST", "/api/computer/code", {
          query,
          sessionId,
          language: overrideLang ?? lang,
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          const errMsg = data.error || `Ошибка ${res.status}`;
          setCode(`${LANG_COMMENT[overrideLang ?? lang]} Ошибка генерации: ${errMsg}`);
          setPhase("error");
          return;
        }

        // Show generated code
        const detectedLang = (data.language === "typescript" ? "javascript" : (data.language ?? (overrideLang ?? lang))) as Lang;
        setLang(detectedLang);
        setCode(data.code || "");

        // If sandbox already ran (server returns sandbox result), use it
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
          // Manually run
          setPhase("running");
          await runCode(data.code, detectedLang);
        }
      } catch (err: any) {
        setCode(`${LANG_COMMENT[overrideLang ?? lang]} Ошибка: ${err.message}`);
        setPhase("error");
      }
    },
    [lang, sessionId]
  );

  // Manual run of current code
  const runCode = useCallback(
    async (codeToRun?: string, forceLang?: Lang) => {
      const src = codeToRun ?? code;
      const langToUse = forceLang ?? lang;
      if (!src.trim()) return;

      setPhase("running");
      setResult(null);

      try {
        const res = await apiRequest("POST", "/api/sandbox/run", {
          code: src,
          language: langToUse,
          sessionId,
          timeout: 15000,
        });
        const data = await res.json();

        if (!res.ok) {
          setResult({
            output: "",
            error: data.error || `Ошибка сервера: ${res.status}`,
            exitCode: 1,
            durationMs: 0,
            language: langToUse,
          });
        } else {
          setResult({
            output: data.output ?? data.stdout ?? "",
            error: data.error ?? data.stderr ?? "",
            exitCode: data.exitCode ?? null,
            durationMs: data.durationMs ?? 0,
            language: data.language ?? langToUse,
          });
        }
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

  // Auto-generate on mount if query provided
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initialQuery.trim()) {
      // Detect language from query before generating
      const lower = initialQuery.toLowerCase();
      let detectedLang: Lang = "python";
      if (/\btypescript\b|\bts\b/.test(lower)) detectedLang = "javascript";
      else if (/\bjavascript\b|\bjs\b|\bnode\.?js\b/.test(lower)) detectedLang = "javascript";
      else if (/\bbash\b|\bshell\b/.test(lower)) detectedLang = "bash";
      setLang(detectedLang);
      generateAndRun(initialQuery, detectedLang);
    }
  }, []); // eslint-disable-line

  // Copy code to clipboard
  const handleCopy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isWorking = phase === "generating" || phase === "running";

  return (
    <div className="h-screen flex flex-col bg-background text-foreground" data-testid="code-window">

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div className="h-11 border-b border-border flex items-center px-3 gap-2.5 shrink-0 bg-card/50">
        {/* Back */}
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

        <div className="w-px h-5 bg-border mx-1 shrink-0" />

        {/* Comet logo mark */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
            <Zap className="h-3 w-3 text-primary" />
          </div>
          <span className="text-[12px] font-semibold text-foreground/80 hidden sm:block">
            Code
          </span>
        </div>

        {/* Status badge */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
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
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* ── Query Bar ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card/30 px-4 py-2 flex items-center gap-2">
        <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          type="text"
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isWorking) {
              generateAndRun(userQuery);
            }
          }}
          placeholder="Опишите задачу на коде…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40 text-foreground"
          data-testid="input-code-query"
        />
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5 shrink-0"
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

      {/* ── Main Split: Code | Output ────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">

        {/* Left: Code Editor */}
        <div className="flex-1 flex flex-col min-h-0 border-r border-border">

          {/* Code toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/60 shrink-0 bg-card/20">
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

            <div className="flex-1" />

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

            {/* Re-run */}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2 gap-1 text-muted-foreground"
              onClick={() => runCode()}
              disabled={isWorking || !code.trim()}
              data-testid="button-rerun"
            >
              <RotateCcw className="h-3 w-3" />
              Перезапустить
            </Button>

            {/* Run */}
            <Button
              size="sm"
              className="h-6 text-[10px] px-2.5 gap-1"
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
          </div>

          {/* Code area */}
          <div className="flex-1 relative min-h-0">
            <Textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-full w-full resize-none rounded-none border-0 font-mono text-[13px] bg-black/25 text-foreground leading-relaxed p-4 focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder={`${LANG_COMMENT[lang]} Код появится здесь после генерации…`}
              spellCheck={false}
              data-testid="textarea-code"
            />
            {/* Filename pill */}
            {code && (
              <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded bg-muted/40 text-[10px] font-mono text-muted-foreground/60 pointer-events-none select-none">
                main{LANG_EXT[lang]}
              </div>
            )}
          </div>
        </div>

        {/* Right: Output */}
        <div className="w-[45%] flex flex-col min-h-0 bg-black/20">
          {/* Output header */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 shrink-0 bg-card/20">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-[11px] font-medium text-muted-foreground/70">
              Вывод
            </span>
            {result && (
              <span
                className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  result.exitCode === 0
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 text-red-400"
                }`}
                data-testid="output-meta-exit"
              >
                exit {result.exitCode ?? "?"}
              </span>
            )}
          </div>

          {/* Output body */}
          <div className="flex-1 min-h-0">
            <OutputPanel phase={phase} result={result} />
          </div>
        </div>
      </div>
    </div>
  );
}
