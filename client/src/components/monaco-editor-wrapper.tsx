/**
 * MonacoEditorWrapper
 *
 * Thin wrapper around @monaco-editor/react that:
 *  – configures the correct language / theme per app theme
 *  – exposes a clean ref for external value injection
 *  – shows a styled fallback textarea while Monaco loads
 */

import { useRef, useCallback, useEffect } from "react";
import MonacoEditor, { type OnMount, type Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditorType } from "monaco-editor";
import { useTheme } from "@/lib/theme";

// ── language id mapping ───────────────────────────────────────────────────────
export type EditorLang = "python" | "javascript" | "bash";

const MONACO_LANG: Record<EditorLang, string> = {
  python: "python",
  javascript: "javascript",
  bash: "shell",
};

// ── custom dark theme matching Local Comet's dark palette ────────────────────
const COMET_DARK_THEME = "comet-dark";
const COMET_LIGHT_THEME = "comet-light";

function defineThemes(monaco: Monaco) {
  monaco.editor.defineTheme(COMET_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5a6680", fontStyle: "italic" },
      { token: "keyword", foreground: "61b8d6" },
      { token: "string", foreground: "85c88a" },
      { token: "number", foreground: "d6b85a" },
      { token: "type", foreground: "7ec8e3" },
    ],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#d4d8e2",
      "editorLineNumber.foreground": "#3c4456",
      "editorLineNumber.activeForeground": "#61b8d6",
      "editor.lineHighlightBackground": "#161b22",
      "editor.selectionBackground": "#264f78",
      "editorCursor.foreground": "#61b8d6",
      "editorIndentGuide.background": "#1e2530",
      "editorIndentGuide.activeBackground": "#2c3340",
      "scrollbarSlider.background": "#2c3340",
      "scrollbarSlider.hoverBackground": "#3c4456",
      "editor.findMatchBackground": "#264f78",
    },
  });

  monaco.editor.defineTheme(COMET_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6e7681", fontStyle: "italic" },
      { token: "keyword", foreground: "0072b1" },
      { token: "string", foreground: "0a7a3f" },
      { token: "number", foreground: "935f00" },
      { token: "type", foreground: "005f87" },
    ],
    colors: {
      "editor.background": "#f6f8fa",
      "editor.foreground": "#1f2329",
      "editorLineNumber.foreground": "#9aacbe",
      "editorLineNumber.activeForeground": "#0072b1",
      "editor.lineHighlightBackground": "#f0f3f7",
      "editor.selectionBackground": "#b3d3eb",
      "editorCursor.foreground": "#0072b1",
      "editorIndentGuide.background": "#e4e7eb",
      "editorIndentGuide.activeBackground": "#c8cdd4",
    },
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface MonacoEditorWrapperProps {
  value: string;
  onChange: (value: string) => void;
  language: EditorLang;
  readOnly?: boolean;
  placeholder?: string;
  /** data-testid on the fallback textarea */
  testId?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MonacoEditorWrapper({
  value,
  onChange,
  language,
  readOnly = false,
  placeholder,
  testId = "monaco-editor",
}: MonacoEditorWrapperProps) {
  const { theme } = useTheme();
  const editorRef = useRef<MonacoEditorType.IStandaloneCodeEditor | null>(null);

  const monacoTheme = theme === "dark" ? COMET_DARK_THEME : COMET_LIGHT_THEME;

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      defineThemes(monaco);
      monaco.editor.setTheme(monacoTheme);

      // Ensure placeholder text is set when empty
      if (!value && placeholder) {
        // Monaco doesn't have native placeholder; we rely on the overlay below
      }
    },
    [monacoTheme, value, placeholder]
  );

  // Sync theme when it changes after mount
  useEffect(() => {
    if (editorRef.current) {
      // Access global monaco from window (loaded by @monaco-editor/react)
      (window as any).monaco?.editor?.setTheme(monacoTheme);
    }
  }, [monacoTheme]);

  return (
    <div className="relative h-full w-full" data-testid={testId}>
      {/* Placeholder overlay — visible only when value is empty */}
      {!value && placeholder && (
        <div
          className="absolute top-0 left-0 z-10 pointer-events-none pl-[58px] pt-[14px] text-[13px] font-mono text-muted-foreground/40 select-none leading-relaxed"
          aria-hidden="true"
        >
          {placeholder}
        </div>
      )}

      <MonacoEditor
        height="100%"
        width="100%"
        language={MONACO_LANG[language]}
        value={value}
        theme={monacoTheme}
        onMount={handleMount}
        onChange={(v) => onChange(v ?? "")}
        loading={
          <div className="h-full w-full flex items-center justify-center bg-[#0d1117] text-muted-foreground/40 text-sm font-mono">
            Загрузка редактора…
          </div>
        }
        options={{
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontLigatures: true,
          lineNumbers: "on",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          readOnly,
          renderLineHighlight: "all",
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
          padding: { top: 12, bottom: 12 },
          tabSize: 2,
          insertSpaces: true,
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 4,
          contextmenu: false,
        }}
      />
    </div>
  );
}
