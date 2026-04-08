/**
 * Code Window — Code VM-style single-screen workflow.
 *
 * Route: /#/code?q=<user query>
 *
 * Layout (mirrors Code VM exactly):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Top bar: back · logo · [mode chips] · status · theme    │
 *   ├──────────────────────┬───────────────────────────────────┤
 *   │  Editor toolbar:     │  Visor toolbar: ВИЗОР · refresh   │
 *   │  [lang badge] [lang  │  · fullscreen                     │
 *   │  dropdown] [Run]     │                                   │
 *   │  [Debug] [Format]    │                                   │
 *   │  [Copy] [Download]   │                                   │
 *   │  [Clear]             │                                   │
 *   │----------------------│---------------------------------- │
 *   │                      │                                   │
 *   │   Monaco Editor      │   Preview / Output / Debug pane  │
 *   │   (left, draggable)  │   (right)                        │
 *   │                      │                                   │
 *   ├──────────────────────┴───────────────────────────────────┤
 *   │  Bottom prompt bar (full width):                         │
 *   │  [prompt textarea] [Сгенерировать] [Правки] [Сохранить]  │
 *   │  [Открыть]                                               │
 *   └──────────────────────────────────────────────────────────┘
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  Bug,
  PenLine,
  Sun,
  Moon,
  RefreshCw,
  Clock,
  Hash,
  Download,
  ExternalLink,
  Wand2,
  Eye,
  FileCode2,
  Code2,
  ChevronDown,
  Trash2,
  Maximize2,
  AlignLeft,
  Terminal,
  Save,
  Zap,
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
  | "formatting"
  | "done"
  | "error";

// Full Code VM language set
export type Lang = EditorLang;

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

// ── Language definitions (Code VM complete set) ───────────────────────────────

interface LangDef {
  id: Lang;
  label: string;
  ext: string;
  comment: string;
  previewable: boolean;
  executable: boolean;
  emoji: string;
}

const LANG_DEFS: LangDef[] = [
  { id: "html",       label: "HTML",        ext: ".html", comment: "<!--",  previewable: true,  executable: false, emoji: "🌐" },
  { id: "css",        label: "CSS",         ext: ".css",  comment: "/*",    previewable: true,  executable: false, emoji: "🎨" },
  { id: "javascript", label: "JavaScript",  ext: ".js",   comment: "//",    previewable: true,  executable: true,  emoji: "⚡" },
  { id: "typescript", label: "TypeScript",  ext: ".ts",   comment: "//",    previewable: false, executable: true,  emoji: "🔷" },
  { id: "python",     label: "Python",      ext: ".py",   comment: "#",     previewable: false, executable: true,  emoji: "🐍" },
  { id: "bash",       label: "Shell/Bash",  ext: ".sh",   comment: "#",     previewable: false, executable: true,  emoji: "💻" },
  { id: "json",       label: "JSON",        ext: ".json", comment: "//",    previewable: false, executable: false, emoji: "📋" },
  { id: "xml",        label: "XML",         ext: ".xml",  comment: "<!--",  previewable: true,  executable: false, emoji: "📄" },
  { id: "yaml",       label: "YAML",        ext: ".yml",  comment: "#",     previewable: false, executable: false, emoji: "📝" },
  { id: "markdown",   label: "Markdown",    ext: ".md",   comment: "<!--",  previewable: false, executable: false, emoji: "📖" },
  { id: "sql",        label: "SQL",         ext: ".sql",  comment: "--",    previewable: false, executable: false, emoji: "🗄️" },
  { id: "powershell", label: "PowerShell",  ext: ".ps1",  comment: "#",     previewable: false, executable: false, emoji: "🔵" },
  { id: "java",       label: "Java",        ext: ".java", comment: "//",    previewable: false, executable: false, emoji: "☕" },
  { id: "kotlin",     label: "Kotlin",      ext: ".kt",   comment: "//",    previewable: false, executable: false, emoji: "🎯" },
  { id: "cpp",        label: "C++",         ext: ".cpp",  comment: "//",    previewable: false, executable: false, emoji: "⚙️" },
  { id: "c",          label: "C",           ext: ".c",    comment: "//",    previewable: false, executable: false, emoji: "🔧" },
  { id: "csharp",     label: "C#",          ext: ".cs",   comment: "//",    previewable: false, executable: false, emoji: "🟣" },
  { id: "go",         label: "Go",          ext: ".go",   comment: "//",    previewable: false, executable: false, emoji: "🐹" },
  { id: "rust",       label: "Rust",        ext: ".rs",   comment: "//",    previewable: false, executable: false, emoji: "🦀" },
  { id: "swift",      label: "Swift",       ext: ".swift",comment: "//",    previewable: false, executable: false, emoji: "🍎" },
  { id: "php",        label: "PHP",         ext: ".php",  comment: "//",    previewable: false, executable: false, emoji: "🐘" },
  { id: "ruby",       label: "Ruby",        ext: ".rb",   comment: "#",     previewable: false, executable: false, emoji: "💎" },
  { id: "r",          label: "R",           ext: ".r",    comment: "#",     previewable: false, executable: false, emoji: "📊" },
  { id: "dockerfile", label: "Dockerfile",  ext: "",      comment: "#",     previewable: false, executable: false, emoji: "🐳" },
  { id: "plaintext",  label: "Plain text",  ext: ".txt",  comment: "",      previewable: false, executable: false, emoji: "📃" },
];

const LANG_MAP = Object.fromEntries(LANG_DEFS.map((d) => [d.id, d])) as Record<Lang, LangDef>;

function getLangDef(id: Lang): LangDef {
  return LANG_MAP[id] ?? LANG_DEFS[0];
}

function isPreviewable(lang: Lang): boolean {
  return getLangDef(lang).previewable;
}

function getLangExt(lang: Lang): string {
  return getLangDef(lang).ext;
}

function getLangComment(lang: Lang): string {
  return getLangDef(lang).comment;
}

// ── Lang detection from query ─────────────────────────────────────────────────

function detectLang(text: string): Lang {
  const lower = text.toLowerCase();
  if (/\bhtml\b|сайт|веб.?страниц|landing|web\s*page|html.?страниц/.test(lower)) return "html";
  if (/\bcss\b|стил[ьи]|стиль/.test(lower)) return "css";
  if (/\btypescript\b|\bts\b/.test(lower)) return "typescript";
  if (/\bjavascript\b|\bjs\b|\bnode\.?js\b/.test(lower)) return "javascript";
  if (/\bbash\b|\bshell\b/.test(lower)) return "bash";
  if (/\brust\b/.test(lower)) return "rust";
  if (/\bgo\b|\bgolang\b/.test(lower)) return "go";
  if (/\bjava\b/.test(lower)) return "java";
  if (/\bc#\b|\bcsharp\b/.test(lower)) return "csharp";
  if (/\bc\+\+\b|\bcpp\b/.test(lower)) return "cpp";
  if (/\bruby\b/.test(lower)) return "ruby";
  if (/\bphp\b/.test(lower)) return "php";
  if (/\bsql\b/.test(lower)) return "sql";
  if (/\bjson\b/.test(lower)) return "json";
  if (/\byaml\b/.test(lower)) return "yaml";
  if (/\bmarkdown\b/.test(lower)) return "markdown";
  // Heuristics: game / app / website → HTML for richer preview
  if (/игр[уаыею]|игру|игра|игры| игре|игрой|game|app.*html|html.*app|dashboard|дашборд/.test(lower)) return "html";
  return "python";
}

// ── URL query parser ──────────────────────────────────────────────────────────

function getQueryParam(search: string, key: string): string {
  const idx = search.indexOf("?");
  if (idx === -1) return "";
  const params = new URLSearchParams(search.slice(idx + 1));
  return params.get(key) ?? "";
}

// ── Simple client-side code formatter ─────────────────────────────────────────

function clientFormatCode(code: string, lang: Lang): string {
  if (!code.trim()) return code;

  if (lang === "python") {
    return code
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trimEnd();
  }

  if (lang === "html") {
    let indent = 0;
    const lines = code.split("\n").map((line) => line.trim()).filter(Boolean);
    const formatted: string[] = [];
    const selfClose = /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)/i;
    const closeOnly = /^<\//;
    const openClose = /<[^/][^>]*>[^<]*<\/[^>]+>/;

    for (const line of lines) {
      if (closeOnly.test(line) && !openClose.test(line)) {
        indent = Math.max(0, indent - 1);
      }
      formatted.push("  ".repeat(indent) + line);
      if (
        !selfClose.test(line) &&
        !closeOnly.test(line) &&
        !openClose.test(line) &&
        /<[^/][^>]*[^/]>/.test(line)
      ) {
        indent++;
      }
    }
    return formatted.join("\n");
  }

  return code
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

// ── Status indicator ──────────────────────────────────────────────────────────

function StatusLine({
  phase,
  statusMsg,
  lang,
}: {
  phase: Phase;
  statusMsg: string;
  lang: Lang;
}) {
  if (!statusMsg && phase === "idle") return null;

  const color =
    phase === "generating" || phase === "patching"
      ? "text-purple-400"
      : phase === "running"
      ? "text-blue-400"
      : phase === "debugging"
      ? "text-orange-400"
      : phase === "formatting"
      ? "text-sky-400"
      : phase === "done"
      ? "text-emerald-400"
      : phase === "error"
      ? "text-red-400"
      : "text-muted-foreground";

  const spinner =
    phase === "generating" ||
    phase === "patching" ||
    phase === "running" ||
    phase === "debugging" ||
    phase === "formatting";

  return (
    <div className={`flex items-center gap-2 text-[11px] font-mono ${color} select-none`} data-testid="status-line">
      {spinner && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
      <span className="truncate">{statusMsg || (phase === "idle" ? "Готов" : "")}</span>
    </div>
  );
}

// ── Language selector dropdown (Code VM style) ────────────────────────────────

function LangSelector({
  lang,
  onChange,
  disabled,
}: {
  lang: Lang;
  onChange: (l: Lang) => void;
  disabled?: boolean;
}) {
  const def = getLangDef(lang);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1 text-[11px] font-mono text-primary hover:text-primary hover:bg-primary/10 border border-primary/20"
          disabled={disabled}
          data-testid="lang-selector-trigger"
        >
          <span>{def.emoji}</span>
          <span>{def.label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-44 max-h-[70vh] overflow-y-auto bg-popover border border-border"
        data-testid="lang-selector-menu"
      >
        {LANG_DEFS.map((d, i) => (
          <>
            {i === 6 && <DropdownMenuSeparator key="sep1" />}
            {i === 12 && <DropdownMenuSeparator key="sep2" />}
            {i === 20 && <DropdownMenuSeparator key="sep3" />}
            <DropdownMenuItem
              key={d.id}
              onClick={() => onChange(d.id)}
              className={`text-[12px] gap-2 cursor-pointer ${d.id === lang ? "bg-primary/10 text-primary" : ""}`}
              data-testid={`lang-option-${d.id}`}
            >
              <span className="w-4">{d.emoji}</span>
              <span>{d.label}</span>
              {d.id === lang && <CheckCircle2 className="h-3 w-3 ml-auto text-primary" />}
            </DropdownMenuItem>
          </>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Debug output bottom drawer ────────────────────────────────────────────────

function DebugDrawer({
  open,
  onClose,
  phase,
  result,
  debugResult,
  onApplyFix,
}: {
  open: boolean;
  onClose: () => void;
  phase: Phase;
  result: RunResult | null;
  debugResult: DebugResult | null;
  onApplyFix: (code: string) => void;
}) {
  if (!open) return null;

  return (
    <div
      className="shrink-0 border-t border-border/60 bg-[#0d1117] dark:bg-[#0d1117]"
      style={{ height: "220px" }}
      data-testid="debug-drawer"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 bg-card/30">
        <Terminal className="h-3.5 w-3.5 text-orange-400/70" />
        <span className="text-[11px] font-mono text-orange-400/80 uppercase tracking-wider">Вывод</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={onClose}
          data-testid="button-debug-close"
        >
          ✕
        </Button>
      </div>
      <ScrollArea className="h-[calc(100%-32px)]">
        <div className="p-3 font-mono text-[12px]">
          {phase === "debugging" && (
            <div className="flex items-center gap-2 text-orange-400/70">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>LLM анализирует ошибки…</span>
            </div>
          )}
          {phase === "running" && (
            <div className="flex items-center gap-2 text-blue-400/70">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Выполняется…</span>
            </div>
          )}
          {result && (
            <>
              {result.output && (
                <pre className="text-emerald-400/90 whitespace-pre-wrap break-all leading-relaxed">
                  {result.output}
                </pre>
              )}
              {result.error && (
                <pre className="text-red-400/90 whitespace-pre-wrap break-all leading-relaxed mt-2">
                  {result.error}
                </pre>
              )}
              {!result.output && !result.error && (
                <span className="text-muted-foreground/40 italic">Нет вывода</span>
              )}
            </>
          )}
          {debugResult && (
            <div className="space-y-3 mt-2">
              <div className="text-orange-300/80">{debugResult.explanation}</div>
              {debugResult.suggestedFix && (
                <div className="text-amber-300/70">{debugResult.suggestedFix}</div>
              )}
              {debugResult.fixedCode && (
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 gap-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 mb-2"
                    onClick={() => onApplyFix(debugResult.fixedCode!)}
                    data-testid="button-apply-fix"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Применить исправление
                  </Button>
                  <pre className="text-foreground/70 bg-black/25 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px]">
                    {debugResult.fixedCode}
                  </pre>
                </div>
              )}
            </div>
          )}
          {!result && !debugResult && phase === "idle" && (
            <span className="text-muted-foreground/40 italic">
              Нажмите «Дебаг» для анализа ошибок или «Запустить» для выполнения.
            </span>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Preview Pane (right side, Code VM Visor style) ────────────────────────────

function VisorPane({
  code,
  lang,
  phase,
  result,
}: {
  code: string;
  lang: Lang;
  phase: Phase;
  result: RunResult | null;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const buildSrcDoc = useCallback((): string => {
    if (lang === "css") {
      return `<!DOCTYPE html><html><head><style>body{margin:0;padding:16px;background:#111;color:#d4d8e2;font-family:system-ui}${code}</style></head><body><div class="preview-root"><p style="color:#666;font-size:12px;padding:8px 0">CSS Preview — HTML будет отображён здесь</p></div></body></html>`;
    }
    if (lang === "xml") {
      return `<!DOCTYPE html><html><head><style>body{margin:0;padding:16px;background:#0d1117;color:#d4d8e2;font-family:monospace;font-size:12px}pre{white-space:pre-wrap}</style></head><body><pre>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
    }
    if (lang === "markdown") {
      // Simple markdown render
      const escaped = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const rendered = escaped
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
      return `<!DOCTYPE html><html><head><style>body{margin:0;padding:20px;background:#0d1117;color:#d4d8e2;font-family:system-ui;line-height:1.6}h1,h2,h3{color:#61b8d6}code{background:#1e2530;padding:2px 4px;border-radius:3px}</style></head><body>${rendered}</body></html>`;
    }
    if (lang === "javascript" || lang === "typescript") {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;font-family:monospace;font-size:13px;background:#0d1117;color:#d4d8e2}pre{margin:0;white-space:pre-wrap}</style></head><body><pre id="out"></pre><script>
const _log = console.log;
const _err = console.error;
const pre = document.getElementById('out');
console.log = (...args) => { pre.textContent += args.map(String).join(' ') + '\\n'; _log(...args); };
console.error = (...args) => { pre.textContent += '\\u274c ' + args.map(String).join(' ') + '\\n'; _err(...args); };
window.onerror = (msg, src, line) => { pre.textContent += '\\u274c ERROR: ' + msg + ' (line ' + line + ')\\n'; };
try {
${code}
} catch(e) { pre.textContent += '\\u274c ' + e; }
<\/script></body></html>`;
    }
    // HTML — direct pass-through
    return code;
  }, [code, lang]);

  const refresh = () => setIframeKey((k) => k + 1);

  const openInBrowser = () => {
    const src = buildSrcDoc();
    const blob = new Blob([src], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const generating = phase === "generating" || phase === "patching";

  // Non-previewable: show output panel
  if (!isPreviewable(lang) && lang !== "javascript" && lang !== "typescript") {
    return (
      <div className="h-full flex flex-col" data-testid="visor-output-pane">
        {/* Output visor header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 shrink-0 bg-card/20">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-[11px] font-mono text-muted-foreground/70 uppercase tracking-wider">Вывод</span>
          <div className="flex-1" />
          {result && (
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                result.exitCode === 0
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-red-500/15 text-red-400"
              }`}
            >
              exit {result.exitCode ?? "?"}
            </span>
          )}
          {result && (
            <span className="flex items-center gap-1 text-muted-foreground text-[10px] font-mono">
              <Clock className="h-3 w-3" />
              {result.durationMs}ms
            </span>
          )}
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 font-mono text-[12.5px]">
            {generating && (
              <div className="flex items-center gap-2 text-purple-400/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">{phase === "patching" ? "Применяются правки…" : "Генерируется код…"}</span>
              </div>
            )}
            {phase === "running" && (
              <div className="flex items-center gap-2 text-blue-400/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Выполняется код…</span>
              </div>
            )}
            {phase === "debugging" && (
              <div className="flex items-center gap-2 text-orange-400/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Анализ ошибок…</span>
              </div>
            )}
            {result && !generating && (
              <>
                {result.output && (
                  <pre className="text-emerald-400/90 whitespace-pre-wrap break-all leading-relaxed" data-testid="output-stdout">
                    {result.output}
                  </pre>
                )}
                {result.error && (
                  <pre className="text-red-400/90 whitespace-pre-wrap break-all leading-relaxed mt-2" data-testid="output-stderr">
                    {result.error}
                  </pre>
                )}
                {!result.output && !result.error && (
                  <p className="text-muted-foreground/40 italic text-sm">Нет вывода</p>
                )}
              </>
            )}
            {!result && !generating && phase !== "running" && phase !== "debugging" && (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground/30 text-sm">
                <Terminal className="h-8 w-8 opacity-20" />
                <span>Нажмите «Запустить» для выполнения</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Previewable: show visor iframe
  return (
    <div
      className={`h-full flex flex-col ${isFullscreen ? "fixed inset-0 z-50 bg-background" : ""}`}
      data-testid="visor-preview-pane"
    >
      {/* Visor header — Code VM style */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 shrink-0 bg-card/20">
        <Eye className="h-3.5 w-3.5 text-primary/60" />
        <span className="text-[11px] font-mono text-primary/70 uppercase tracking-wider font-semibold">Визор</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2 gap-1 text-muted-foreground hover:text-foreground"
          onClick={refresh}
          data-testid="button-visor-refresh"
        >
          <RefreshCw className="h-3 w-3" />
          Обновить
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2 gap-1 text-muted-foreground hover:text-sky-400"
          onClick={openInBrowser}
          data-testid="button-visor-open"
        >
          <ExternalLink className="h-3 w-3" />
          В браузер
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setIsFullscreen((v) => !v)}
          data-testid="button-visor-fullscreen"
        >
          <Maximize2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Live preview area */}
      <div className="flex-1 min-h-0 relative">
        {generating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d1117]/90 text-muted-foreground/60 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-purple-400/70" />
            <span className="text-sm">{phase === "patching" ? "Применяются правки…" : "Генерируется код…"}</span>
          </div>
        ) : !code.trim() ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/30 text-sm"
            data-testid="visor-empty"
          >
            <Eye className="h-8 w-8 opacity-20" />
            <span>Предпросмотр появится после генерации кода</span>
          </div>
        ) : null}
        <iframe
          key={iframeKey}
          ref={iframeRef}
          srcDoc={buildSrcDoc()}
          sandbox="allow-scripts allow-same-origin allow-forms"
          className="w-full h-full border-0"
          title="Code Preview"
          data-testid="preview-iframe"
        />
      </div>
    </div>
  );
}

// ── Resizable split ────────────────────────────────────────────────────────────

function useSplitResize(defaultLeftPct = 50) {
  const [leftPct, setLeftPct] = useState(defaultLeftPct);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (me: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = me.clientX - rect.left;
      const pct = Math.min(80, Math.max(20, (x / rect.width) * 100));
      setLeftPct(pct);
    };

    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return { leftPct, containerRef, onMouseDown };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CodeWindowPage() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  // Parse initial query from URL
  const rawSearch = typeof window !== "undefined" ? window.location.search : "";
  const rawHash = typeof window !== "undefined" ? window.location.hash : "";
  const initialQuery = decodeURIComponent(
    getQueryParam(rawSearch, "q") || getQueryParam(rawHash, "q")
  );

  // State
  const [userQuery, setUserQuery] = useState(initialQuery);
  const [lang, setLang] = useState<Lang>(() => detectLang(initialQuery));
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [debugResult, setDebugResult] = useState<DebugResult | null>(null);
  const [sessionId] = useState(() => `cw-${Date.now()}`);
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [debugDrawerOpen, setDebugDrawerOpen] = useState(false);

  // Split
  const { leftPct, containerRef, onMouseDown } = useSplitResize(50);

  const promptRef = useRef<HTMLTextAreaElement>(null);

  const isWorking =
    phase === "generating" ||
    phase === "patching" ||
    phase === "running" ||
    phase === "debugging" ||
    phase === "formatting";

  // Auto-focus prompt on load
  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  // Sync userQuery from native input events (e.g. programmatic form_input via automation)
  // React's synthetic onChange may miss natively dispatched input events on controlled inputs
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    const handler = () => {
      setUserQuery(el.value);
    };
    el.addEventListener("input", handler);
    return () => el.removeEventListener("input", handler);
  }, []);

  // Auto-trigger generation if query was passed via URL
  useEffect(() => {
    if (initialQuery.trim()) {
      const detectedLang = detectLang(initialQuery);
      setLang(detectedLang);
      void generateCode(initialQuery, detectedLang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Generate code ────────────────────────────────────────────────────────────
  const generateCode = useCallback(
    async (query: string, overrideLang?: Lang) => {
      if (!query.trim() || isWorking) return;

      const useLang = overrideLang ?? lang;
      setPhase("generating");
      setResult(null);
      setDebugResult(null);
      setStatusMsg("Генерируется код…");
      const commentChar = getLangComment(useLang);
      setCode(
        commentChar
          ? `${commentChar} Генерация: ${query}\n${commentChar} Пожалуйста, подождите…`
          : `// Генерация: ${query}\n// Пожалуйста, подождите…`
      );

      try {
        const res = await apiRequest("POST", "/api/computer/code", {
          query,
          sessionId,
          language: useLang === "typescript" ? "javascript" : useLang,
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          const errMsg = data.error || `Ошибка ${res.status}`;
          setCode(commentChar ? `${commentChar} Ошибка генерации: ${errMsg}` : `// Ошибка: ${errMsg}`);
          setPhase("error");
          setStatusMsg(`✗ Ошибка: ${errMsg}`);
          return;
        }

        // Detect language from response
        let detectedLang = useLang;
        if (data.language) {
          const dl = data.language as Lang;
          const known = LANG_DEFS.find((d) => d.id === dl);
          if (known) detectedLang = dl;
        }
        setLang(detectedLang);
        setCode(data.code || "");

        const langDef = getLangDef(detectedLang);

        // Auto-open debug drawer for non-previewable langs after run
        if (!isPreviewable(detectedLang)) {
          setDebugDrawerOpen(true);
        }

        // For HTML/CSS: show preview immediately
        if (isPreviewable(detectedLang)) {
          setPhase("done");
          setResult({
            output: "Preview ready",
            error: "",
            exitCode: 0,
            durationMs: 0,
            language: detectedLang,
          });
          setStatusMsg(`✓ Готово! Язык: ${langDef.emoji} ${langDef.label}. Визор обновлён.`);
          return;
        }

        // Run in sandbox if provided
        if (data.sandbox) {
          setPhase("done");
          const r: RunResult = {
            output: data.sandbox.output ?? data.sandbox.stdout ?? "",
            error: data.sandbox.error ?? data.sandbox.stderr ?? "",
            exitCode: data.sandbox.exitCode ?? null,
            durationMs: data.sandbox.durationMs ?? 0,
            language: data.language ?? detectedLang,
          };
          setResult(r);
          setStatusMsg(
            r.exitCode === 0
              ? `✓ Готово! Язык: ${langDef.emoji} ${langDef.label}. Выполнено.`
              : `⚠ Завершено с ошибкой (exit ${r.exitCode})`
          );
        } else {
          // Run manually
          await runCodeImpl(data.code, detectedLang);
        }
      } catch (err: any) {
        setCode(`// Ошибка: ${err.message}`);
        setPhase("error");
        setStatusMsg(`✗ Ошибка: ${err.message}`);
      }
    },
    [lang, sessionId, isWorking]
  );

  // ── Run code ─────────────────────────────────────────────────────────────────
  const runCodeImpl = useCallback(
    async (codeToRun: string, forceLang?: Lang) => {
      const src = codeToRun ?? code;
      const langToUse = forceLang ?? lang;
      if (!src.trim()) return;

      const langDef = getLangDef(langToUse);

      if (isPreviewable(langToUse)) {
        // Just refresh visor
        setPhase("done");
        setResult({
          output: "Preview refreshed",
          error: "",
          exitCode: 0,
          durationMs: 0,
          language: langToUse,
        });
        setStatusMsg(`✓ Визор обновлён. Язык: ${langDef.emoji} ${langDef.label}`);
        return;
      }

      setPhase("running");
      setStatusMsg("Выполняется код…");
      setDebugDrawerOpen(true);

      try {
        const res = await apiRequest("POST", "/api/sandbox/run", {
          code: src,
          language: langToUse === "typescript" ? "javascript" : langToUse,
          sessionId,
        });
        const data = await res.json();

        if (!res.ok) {
          setPhase("done");
          const r: RunResult = {
            output: "",
            error: data.error || `Ошибка ${res.status}`,
            exitCode: 1,
            durationMs: 0,
            language: langToUse,
          };
          setResult(r);
          setStatusMsg(`⚠ Ошибка выполнения`);
          return;
        }

        const r: RunResult = {
          output: data.output ?? data.stdout ?? "",
          error: data.error ?? data.stderr ?? "",
          exitCode: data.exitCode ?? null,
          durationMs: data.durationMs ?? 0,
          language: data.language ?? langToUse,
        };
        setResult(r);
        setPhase("done");
        setStatusMsg(
          r.exitCode === 0
            ? `✓ Выполнено (${r.durationMs}ms)`
            : `⚠ Завершено с ошибкой exit ${r.exitCode}`
        );
      } catch (err: any) {
        setPhase("done");
        setResult({
          output: "",
          error: err.message,
          exitCode: 1,
          durationMs: 0,
          language: langToUse,
        });
        setStatusMsg(`✗ Ошибка: ${err.message}`);
      }
    },
    [code, lang, sessionId]
  );

  const handleRun = useCallback(() => {
    void runCodeImpl(code, lang);
  }, [code, lang, runCodeImpl]);

  // ── Patch / Правки ────────────────────────────────────────────────────────────
  const applyPatch = useCallback(
    async (instructions: string) => {
      if (!instructions.trim() || !code.trim() || isWorking) return;

      setPhase("patching");
      setResult(null);
      setDebugResult(null);
      setStatusMsg("Применяются правки…");

      const langDef = getLangDef(lang);
      const patchPrompt = `Вот текущий ${langDef.label} код:\n\`\`\`\n${code}\n\`\`\`\n\nВнеси следующие правки: ${instructions}\n\nВерни только готовый исправленный код без пояснений.`;

      try {
        const res = await apiRequest("POST", "/api/computer/code", {
          query: patchPrompt,
          sessionId,
          language: lang === "typescript" ? "javascript" : lang,
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          setPhase("error");
          setStatusMsg("✗ Ошибка применения правок");
          return;
        }

        const newCode = data.code || code;
        setCode(newCode);

        if (isPreviewable(lang)) {
          setPhase("done");
          setResult({ output: "Preview updated", error: "", exitCode: 0, durationMs: 0, language: lang });
          setStatusMsg(`✓ Правки применены. Визор обновлён.`);
          return;
        }

        if (data.sandbox) {
          const r: RunResult = {
            output: data.sandbox.output ?? data.sandbox.stdout ?? "",
            error: data.sandbox.error ?? data.sandbox.stderr ?? "",
            exitCode: data.sandbox.exitCode ?? null,
            durationMs: data.sandbox.durationMs ?? 0,
            language: lang,
          };
          setResult(r);
          setPhase("done");
          setStatusMsg(`✓ Правки применены. Выполнено.`);
        } else {
          await runCodeImpl(newCode, lang);
        }
      } catch (err: any) {
        setPhase("error");
        setStatusMsg(`✗ Ошибка: ${err.message}`);
      }
    },
    [code, lang, sessionId, isWorking, runCodeImpl]
  );

  // ── Debug ─────────────────────────────────────────────────────────────────────
  const handleDebug = useCallback(async () => {
    if (!code.trim() || isWorking) return;
    setPhase("debugging");
    setDebugResult(null);
    setDebugDrawerOpen(true);
    setStatusMsg("Анализ ошибок…");

    try {
      const res = await apiRequest("POST", "/api/computer/debug", {
        code,
        language: lang,
        error: result?.error ?? "",
        sessionId,
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setPhase("error");
        setStatusMsg("✗ Ошибка дебага");
        return;
      }

      setDebugResult({
        explanation: data.explanation ?? "",
        suggestedFix: data.suggestedFix,
        fixedCode: data.fixedCode,
      });
      setPhase("done");
      setStatusMsg("✓ Анализ завершён");
    } catch (err: any) {
      setPhase("error");
      setStatusMsg(`✗ Ошибка: ${err.message}`);
    }
  }, [code, lang, result, sessionId, isWorking]);

  // ── Format ────────────────────────────────────────────────────────────────────
  const handleFormat = useCallback(async () => {
    if (!code.trim() || isWorking) return;
    setPhase("formatting");
    setStatusMsg("Форматирование…");

    try {
      const res = await apiRequest("POST", "/api/computer/format", {
        code,
        language: lang,
      });
      const data = await res.json();

      if (res.ok && data.ok && data.code) {
        setCode(data.code);
      } else {
        // Fallback to client-side formatter
        setCode(clientFormatCode(code, lang));
      }
    } catch {
      setCode(clientFormatCode(code, lang));
    }

    setPhase("idle");
    setStatusMsg("✓ Отформатировано");
  }, [code, lang, isWorking]);

  // ── Copy ──────────────────────────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setStatusMsg("✓ Скопировано в буфер");
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  // ── Download ──────────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!code) return;
    const ext = getLangExt(lang);
    const filename = `code${ext || ".txt"}`;
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatusMsg(`✓ Скачан файл: ${filename}`);
  }, [code, lang]);

  // ── Clear ─────────────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setCode("");
    setResult(null);
    setDebugResult(null);
    setPhase("idle");
    setStatusMsg("");
    setDebugDrawerOpen(false);
  }, []);

  // ── Apply debug fix ───────────────────────────────────────────────────────────
  const handleApplyFix = useCallback((fixedCode: string) => {
    setCode(fixedCode);
    setDebugResult(null);
    setStatusMsg("✓ Исправление применено");
  }, []);

  // ── Prompt key handling ───────────────────────────────────────────────────────
  const handlePromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void generateCode(userQuery);
      }
    },
    [userQuery, generateCode]
  );

  return (
    <div
      className="flex flex-col bg-background text-foreground h-full"
      style={{ overflow: "hidden" }}
      data-testid="code-window-page"
    >
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-card/40 shrink-0" style={{ minHeight: "40px" }}>
        {/* Logo — home indicator (this IS the home screen) */}
        <div className="flex items-center gap-1.5" data-testid="app-logo">
          <svg viewBox="0 0 20 20" className="h-4 w-4 text-primary" fill="none" aria-label="Local Comet">
            <circle cx="10" cy="10" r="4" fill="currentColor" opacity="0.9" />
            <path d="M10 2 Q14 6 16 10 Q14 14 10 18" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.5" />
          </svg>
          <span className="text-[12px] font-semibold text-foreground/80 hidden sm:inline">Local Comet</span>
        </div>

        {/* Vertical separator */}
        <div className="w-px h-4 bg-border/60 mx-1 shrink-0" />

        {/* Primary mode tabs: Code (active) | Browser Agent (secondary) */}
        <div className="flex items-center gap-1" data-testid="mode-tabs">
          {/* Code tab — active (this page) */}
          <button
            className="shrink-0 text-[11px] px-2.5 py-1 rounded font-mono transition-colors bg-primary/20 text-primary border border-primary/30"
            data-testid="tab-code"
          >
            ⚡ Code
          </button>
          {/* Browser Agent tab — navigates to /browser-agent */}
          <Link href="/browser-agent">
            <button
              className="shrink-0 text-[11px] px-2.5 py-1 rounded font-mono transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/30"
              data-testid="tab-browser-agent"
            >
              🌐 Browser Agent
            </button>
          </Link>
          {/* Settings shortcut */}
          <Link href="/providers">
            <button
              className="shrink-0 text-[11px] px-2.5 py-1 rounded font-mono transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/30"
              data-testid="tab-settings-top"
            >
              ⚙ Providers
            </button>
          </Link>
        </div>

        {/* Mode chip strip (editor layout modes) */}
        <div className="flex items-center gap-1 ml-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {[
            { label: "Ред+Визор", active: true },
            { label: "Редактор", active: false },
            { label: "Визор", active: false },
          ].map((chip) => (
            <button
              key={chip.label}
              className={`shrink-0 text-[11px] px-2.5 py-1 rounded font-mono transition-colors ${
                chip.active
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              }`}
              data-testid={`mode-chip-${chip.label}`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Status line in top bar */}
        <StatusLine phase={phase} statusMsg={statusMsg} lang={lang} />

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={toggleTheme}
          data-testid="button-theme-toggle"
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* ── Editor + Visor toolbars ───────────────────────────────────────────── */}
      <div
        className="flex border-b border-border/60 bg-card/30 shrink-0"
        style={{ minHeight: "36px" }}
        ref={containerRef}
      >
        {/* Left: Editor toolbar */}
        <div
          className="flex items-center gap-1 px-2 py-1 border-r border-border/60 overflow-x-auto"
          style={{ width: `${leftPct}%`, scrollbarWidth: "none" }}
          data-testid="editor-toolbar"
        >
          {/* Lang badge + selector */}
          <div className="flex items-center gap-1 mr-1 shrink-0">
            <Badge
              variant="secondary"
              className="text-[10px] font-mono px-1.5 py-0 h-5 shrink-0"
              data-testid="lang-badge"
            >
              {getLangDef(lang).emoji} {getLangDef(lang).label}
            </Badge>
            <LangSelector lang={lang} onChange={setLang} disabled={isWorking} />
          </div>

          <div className="w-px h-4 bg-border/60 shrink-0 mx-0.5" />

          {/* Run */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-[11px] text-green-400 hover:text-green-300 hover:bg-green-500/10 shrink-0"
            onClick={handleRun}
            disabled={isWorking || !code.trim()}
            data-testid="button-run"
          >
            <Play className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Запустить</span>
          </Button>

          {/* Debug */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-[11px] text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 shrink-0"
            onClick={handleDebug}
            disabled={isWorking || !code.trim()}
            data-testid="button-debug"
          >
            <Bug className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Дебаг</span>
          </Button>

          {/* Format */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-[11px] text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 shrink-0"
            onClick={handleFormat}
            disabled={isWorking || !code.trim()}
            data-testid="button-format"
          >
            <AlignLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Формат</span>
          </Button>

          <div className="w-px h-4 bg-border/60 shrink-0 mx-0.5" />

          {/* Copy */}
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 px-2 gap-1 text-[11px] shrink-0 ${copied ? "text-emerald-400" : "text-muted-foreground hover:text-foreground"}`}
            onClick={handleCopy}
            disabled={!code.trim()}
            data-testid="button-copy"
          >
            <Copy className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{copied ? "Скопировано" : "Копировать"}</span>
          </Button>

          {/* Download */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
            onClick={handleDownload}
            disabled={!code.trim()}
            data-testid="button-download"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Скачать</span>
          </Button>

          {/* Clear */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-[11px] text-muted-foreground hover:text-red-400 hover:bg-red-500/10 shrink-0"
            onClick={handleClear}
            disabled={!code.trim() && !result}
            data-testid="button-clear"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Right: Visor toolbar */}
        <div
          className="flex items-center gap-2 px-3 py-1"
          style={{ flex: 1 }}
          data-testid="visor-toolbar"
        >
          <Eye className="h-3.5 w-3.5 text-primary/50 shrink-0" />
          <span className="text-[11px] font-mono font-semibold text-primary/60 uppercase tracking-wider shrink-0">
            {isPreviewable(lang) ? "Визор" : "Вывод"}
          </span>
          <div className="flex-1" />
          {/* Debug drawer toggle */}
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 px-2 gap-1 text-[10px] shrink-0 ${debugDrawerOpen ? "text-orange-400 bg-orange-500/10" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setDebugDrawerOpen((v) => !v)}
            data-testid="button-toggle-debug-drawer"
          >
            <Terminal className="h-3 w-3" />
            Консоль
          </Button>
        </div>
      </div>

      {/* ── Main split area ───────────────────────────────────────────────────── */}
      <div
        className="flex flex-1 min-h-0 relative"
        ref={containerRef}
      >
        {/* LEFT: Monaco Editor */}
        <div
          className="flex flex-col min-h-0 border-r border-border/60"
          style={{ width: `${leftPct}%` }}
          data-testid="editor-pane"
        >
          {/* Editor with optional debug drawer */}
          <div className="flex-1 min-h-0" style={{ position: "relative", overflow: "hidden" }}>
            <MonacoEditorWrapper
              value={code}
              onChange={setCode}
              language={lang}
              placeholder={`// Сгенерируйте код через строку ниже…\n// Опишите задачу: лендинг, игра, скрипт Python, дашборд, алгоритм…`}
              testId="monaco-editor-main"
            />
          </div>

          {/* Debug / Output drawer at bottom of editor */}
          <DebugDrawer
            open={debugDrawerOpen}
            onClose={() => setDebugDrawerOpen(false)}
            phase={phase}
            result={result}
            debugResult={debugResult}
            onApplyFix={handleApplyFix}
          />
        </div>

        {/* Drag divider */}
        <div
          className="w-1 cursor-col-resize bg-border/40 hover:bg-primary/40 transition-colors shrink-0 active:bg-primary/60"
          onMouseDown={onMouseDown}
          data-testid="split-divider"
        />

        {/* RIGHT: Visor / Preview */}
        <div className="flex flex-col min-h-0" style={{ flex: 1 }} data-testid="visor-pane">
          <VisorPane
            code={code}
            lang={lang}
            phase={phase}
            result={result}
          />
        </div>
      </div>

      {/* ── Bottom Prompt Bar (full width, Code VM style) ─────────────────────── */}
      <div
        className="border-t border-border/60 bg-card/40 shrink-0"
        data-testid="prompt-bar"
      >
        <div className="flex items-end gap-2 p-2">
          {/* Main prompt textarea */}
          <div className="flex-1 relative">
            <textarea
              ref={promptRef}
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="Опишите задачу: лендинг, игра, скрипт на Python, дашборд, алгоритм… (Enter — сгенерировать, Shift+Enter — новая строка)"
              rows={2}
              className="w-full bg-muted/20 border border-border/50 rounded px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-primary/40 focus:bg-muted/30 transition-colors font-sans leading-relaxed"
              disabled={isWorking}
              data-testid="input-prompt"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 shrink-0 pb-0.5">
            {/* Generate — primary CTA */}
            <Button
              className="h-9 px-3 gap-1.5 text-[12px] font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
              onClick={() => generateCode(userQuery)}
              disabled={isWorking || !userQuery.trim()}
              data-testid="button-generate"
            >
              {phase === "generating" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Сгенерировать
            </Button>

            {/* Правки — refine existing code */}
            <Button
              variant="outline"
              className="h-9 px-3 gap-1.5 text-[12px] border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 shrink-0"
              onClick={() => applyPatch(userQuery)}
              disabled={isWorking || !userQuery.trim() || !code.trim()}
              data-testid="button-patch"
            >
              {phase === "patching" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PenLine className="h-3.5 w-3.5" />
              )}
              Правки
            </Button>

            {/* Save / Download */}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2 gap-1 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
              onClick={handleDownload}
              disabled={!code.trim()}
              data-testid="button-save"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Сохранить</span>
            </Button>

            {/* Open in browser */}
            {isPreviewable(lang) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2 gap-1 text-[11px] text-muted-foreground hover:text-sky-400 shrink-0"
                onClick={() => {
                  if (!code.trim()) return;
                  const blob = new Blob([code], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank");
                  setTimeout(() => URL.revokeObjectURL(url), 10000);
                }}
                disabled={!code.trim()}
                data-testid="button-open-in-browser"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Открыть</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
