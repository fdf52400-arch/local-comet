/**
 * Local Comet — Terminal & Code Sandbox
 *
 * Real shell execution with:
 *  - Per-session working directory (scoped to /tmp/local-comet-sandbox/<sessionId>)
 *  - Command timeout (default 10s, max 30s)
 *  - stdout/stderr capture
 *  - Blocked dangerous command list
 *  - Code sandbox: JS (node --eval), Python (python3/python -c), Bash/Shell
 *
 * Security model (local-only MVP):
 *  - NOT safe for public internet deployment. For local use only.
 *  - The sandbox dir is isolated per session but shares the host OS.
 *  - Dangerous command prefixes are blocked at the string level.
 */

import { execFile, exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

const SANDBOX_ROOT = path.join(os.tmpdir(), "local-comet-sandbox");

const IS_WINDOWS = process.platform === "win32";

// Commands that are always blocked regardless of context
const BLOCKED_COMMANDS = [
  /^rm\s+-rf\s+\//, // rm -rf /
  /^sudo\s+rm/,
  /^mkfs/,
  /^dd\s+if=\/dev\/zero/,
  /^:\(\){.*}\s*;/,  // fork bomb
  />\\s*\/dev\/(sd|hd|nvme|vda)/, // direct disk writes
  /^chmod\s+-R\s+777\s+\//, // mass chmod /
];

function isBlocked(cmd: string): string | null {
  const normalized = cmd.trim();
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(normalized)) {
      return `Команда заблокирована: соответствует шаблону ${pattern}`;
    }
  }
  return null;
}

/**
 * Returns the platform-appropriate shell and its flag for executing a string command.
 * Windows: cmd.exe /c
 * Unix/macOS: /bin/bash -c (or /bin/sh -c as fallback)
 */
function getPlatformShell(): string {
  if (IS_WINDOWS) {
    return "cmd.exe";
  }
  // Prefer bash, fall back to sh (which is universally available on Unix)
  const hasBash = fs.existsSync("/bin/bash");
  return hasBash ? "/bin/bash" : "/bin/sh";
}

export function getSandboxDir(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const dir = path.join(SANDBOX_ROOT, safe);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  blocked: boolean;
  blockReason?: string;
  cwd: string;
}

/**
 * Execute a shell command in the session sandbox directory.
 * @param command  Raw shell command string
 * @param sessionId  Session identifier (used to derive working directory)
 * @param timeoutMs  Max execution time in ms (default 10000, cap 30000)
 */
export async function executeTerminalCommand(
  command: string,
  sessionId: string = "default",
  timeoutMs = 10_000,
): Promise<ExecResult> {
  const cwd = getSandboxDir(sessionId);
  const timeout = Math.min(timeoutMs, 30_000);

  const blockReason = isBlocked(command);
  if (blockReason) {
    return {
      stdout: "",
      stderr: blockReason,
      exitCode: 1,
      durationMs: 0,
      blocked: true,
      blockReason,
      cwd,
    };
  }

  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 512 * 1024, // 512KB output cap
      shell: getPlatformShell(),
    });
    return {
      stdout: stdout.slice(0, 8000),
      stderr: stderr.slice(0, 2000),
      exitCode: 0,
      durationMs: Date.now() - start,
      blocked: false,
      cwd,
    };
  } catch (err: any) {
    return {
      stdout: (err.stdout || "").slice(0, 8000),
      stderr: (err.stderr || err.message || "").slice(0, 2000),
      exitCode: err.code ?? 1,
      durationMs: Date.now() - start,
      blocked: false,
      cwd,
    };
  }
}

// ── Code Sandbox ──────────────────────────────────────────────────────────────

export type CodeLanguage = "javascript" | "python" | "bash" | "typescript";

export interface SandboxResult {
  output: string;
  error: string;
  exitCode: number | null;
  durationMs: number;
  language: CodeLanguage;
  /** Files present in the sandbox dir after execution (artifacts) */
  files?: string[];
}

/**
 * Run code in a language-specific sandbox.
 * JS/TS: node --eval (or ts-node if available)
 * Python: python3 / python (platform-aware)
 * Bash: bash -c (Unix) or cmd /c (Windows)
 */
export async function runCodeSandbox(
  code: string,
  language: CodeLanguage,
  sessionId: string = "default",
  timeoutMs = 10_000,
): Promise<SandboxResult> {
  const cwd = getSandboxDir(sessionId);
  const timeout = Math.min(timeoutMs, 30_000);
  const start = Date.now();

  // Write code to a temp file for cleaner execution
  const ext = language === "python" ? "py" : language === "typescript" ? "ts" : language === "javascript" ? "js" : "sh";
  const tmpFile = path.join(cwd, `__sandbox_${Date.now()}.${ext}`);

  try {
    fs.writeFileSync(tmpFile, code, "utf8");

    let command: string;
    switch (language) {
      case "javascript":
        command = `node "${tmpFile}"`;
        break;
      case "typescript": {
        // Try ts-node first, then tsx, then fall back to a real transpile via esbuild/tsc
        const hasTsNode = await commandExists("ts-node");
        const hasTsx = await commandExists("tsx");
        const hasEsbuild = await commandExists("esbuild");
        if (hasTsNode) {
          command = `ts-node --transpile-only "${tmpFile}"`;
        } else if (hasTsx) {
          command = `tsx "${tmpFile}"`;
        } else if (hasEsbuild) {
          // Transpile to a temp JS file, then run
          const jsFile = tmpFile.replace(/\.ts$/, ".js");
          command = `esbuild --bundle=false "${tmpFile}" --outfile="${jsFile}" && node "${jsFile}"`;
        } else {
          // No TypeScript runner available — report honestly instead of silently failing
          fs.unlinkSync(tmpFile);
          return {
            output: "",
            error: "TypeScript ранайм недоступен (ts-node, tsx и esbuild не найдены). Установите ts-node ('npm i -g ts-node typescript') или используйте javascript.",
            exitCode: 1,
            durationMs: Date.now() - start,
            language,
          };
        }
        break;
      }
      case "python": {
        // On Windows, 'python3' may not exist; try python3 first, then python
        const pythonCmd = await resolvePythonCommand();
        if (!pythonCmd) {
          fs.unlinkSync(tmpFile);
          return {
            output: "",
            error: "Python не найден. Установите Python с https://python.org (убедитесь, что он добавлен в PATH).",
            exitCode: 1,
            durationMs: Date.now() - start,
            language,
          };
        }
        command = `${pythonCmd} "${tmpFile}"`;
        break;
      }
      case "bash": {
        const blockReason = isBlocked(code);
        if (blockReason) {
          fs.unlinkSync(tmpFile);
          return { output: "", error: blockReason, exitCode: 1, durationMs: 0, language };
        }
        if (IS_WINDOWS) {
          // On Windows, run shell scripts via cmd or PowerShell
          // .sh files are run via cmd /c (basic) or we convert to a .bat-style approach
          command = `powershell -ExecutionPolicy Bypass -File "${tmpFile}"`;
        } else {
          command = `bash "${tmpFile}"`;
        }
        break;
      }
      default:
        fs.unlinkSync(tmpFile);
        return { output: "", error: `Неподдерживаемый язык: ${language}`, exitCode: 1, durationMs: 0, language };
    }

    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 256 * 1024,
      shell: getPlatformShell(),
    });

    const artifacts = listSandboxFiles_internal(cwd);
    return {
      output: stdout.slice(0, 8000),
      error: stderr.slice(0, 2000),
      exitCode: 0,
      durationMs: Date.now() - start,
      language,
      files: artifacts,
    };
  } catch (err: any) {
    const artifacts = listSandboxFiles_internal(cwd);
    return {
      output: (err.stdout || "").slice(0, 8000),
      error: (err.stderr || err.message || "").slice(0, 2000),
      exitCode: err.code ?? 1,
      durationMs: Date.now() - start,
      language,
      files: artifacts,
    };
  } finally {
    try { fs.existsSync(tmpFile) && fs.unlinkSync(tmpFile); } catch {}
    // Also clean up any transpiled .js if we used esbuild path
    const jsFile = tmpFile.replace(/\.ts$/, ".js");
    if (jsFile !== tmpFile) {
      try { fs.existsSync(jsFile) && fs.unlinkSync(jsFile); } catch {}
    }
  }
}

/** Internal helper: list files without creating the dir */
function listSandboxFiles_internal(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter(f => !f.startsWith("__sandbox_"));
  } catch {
    return [];
  }
}

/**
 * Check if a command is available in PATH.
 * Uses 'where' on Windows, 'which' on Unix/macOS.
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const checkCmd = IS_WINDOWS ? `where ${cmd}` : `which ${cmd}`;
    await execAsync(checkCmd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the correct Python executable for the current platform.
 * Returns 'python3', 'python', or null if Python is not available.
 *
 * On Windows: 'python3' typically isn't a thing — check 'python' first
 *   (but also try 'python3' in case the user set it up via pyenv/etc).
 * On Unix/macOS: prefer 'python3' over 'python' (python2 may exist as 'python').
 */
async function resolvePythonCommand(): Promise<string | null> {
  if (IS_WINDOWS) {
    // On Windows, first try 'python' (the standard launcher), then 'python3'
    if (await commandExists("python")) return "python";
    if (await commandExists("python3")) return "python3";
    // Also try 'py' (Windows Python Launcher)
    if (await commandExists("py")) return "py";
    return null;
  } else {
    // Unix/macOS: prefer python3 to avoid python2
    if (await commandExists("python3")) return "python3";
    if (await commandExists("python")) return "python";
    return null;
  }
}

/** List files in the session sandbox directory (excludes temp sandbox files) */
export function listSandboxFiles(sessionId: string): string[] {
  const dir = getSandboxDir(sessionId);
  try {
    return fs.readdirSync(dir).filter(f => !f.startsWith("__sandbox_"));
  } catch {
    return [];
  }
}

/** Read a file from the sandbox (relative path) */
export function readSandboxFile(sessionId: string, filename: string): string {
  const dir = getSandboxDir(sessionId);
  const safe = path.basename(filename); // prevent path traversal
  const full = path.join(dir, safe);
  try {
    return fs.readFileSync(full, "utf8").slice(0, 100_000);
  } catch {
    throw new Error(`Файл не найден: ${safe}`);
  }
}

/** Write a file to the sandbox */
export function writeSandboxFile(sessionId: string, filename: string, content: string): void {
  const dir = getSandboxDir(sessionId);
  const safe = path.basename(filename);
  if (!safe) throw new Error("Некорректное имя файла");
  fs.writeFileSync(path.join(dir, safe), content, "utf8");
}
