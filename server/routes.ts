import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { checkProvider, listModels, chat, requestPlanFromModel } from "./provider-gateway";
import {
  closeBrowser, generateFallbackPlan, resolveConfirm, getPendingConfirm,
  executeManualAction, getPreviewState, takeScreenshot, setSelectedElement, getSelectedElement,
  initBrowser, getSessionState,
  type AgentAction, type AgentRunConfig, type DOMElement,
} from "./agent-engine";
import { enqueueTask, cancelTask, getQueueStatus } from "./task-queue";
import { addClient, getClientCount } from "./event-bus";
import {
  executeTerminalCommand,
  runCodeSandbox,
  listSandboxFiles,
  readSandboxFile,
  writeSandboxFile,
  getSandboxDir,
  type CodeLanguage,
} from "./terminal";
import type { DemoScenario } from "@shared/schema";
import { scoreKworkLead } from "@shared/kwork-scoring";

const DEFAULT_MAX_STEPS = 10;

const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "summarize",
    title: "Суммаризировать страницу",
    description: "Открыть страницу и получить структурированную сводку: заголовки, ключевые разделы, статистика",
    targetUrl: "https://ru.wikipedia.org/wiki/Искусственный_интеллект",
    goal: "Суммаризировать содержимое страницы",
  },
  {
    id: "explore",
    title: "Исследовать сайт",
    description: "Просканировать структуру сайта: найти все ссылки, кнопки, формы, оценить навигацию",
    targetUrl: "https://news.ycombinator.com",
    goal: "Исследовать навигацию и структуру сайта",
  },
  {
    id: "find-form",
    title: "Найти форму обратной связи",
    description: "Проанализировать страницу и найти формы, кнопки отправки, контактную информацию",
    targetUrl: "https://example.com",
    goal: "Найти форму обратной связи или контактные данные",
  },
  {
    id: "action-plan",
    title: "Подготовить план действий",
    description: "Составить подробный план взаимодействия со страницей на основе анализа содержимого",
    targetUrl: "https://httpbin.org",
    goal: "Подготовить план действий по странице",
  },
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ---- Health ----
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "0.6.0",
      timestamp: new Date().toISOString(),
      service: "Local Comet",
      sseClients: getClientCount(),
    });
  });

  // ---- SSE Stream ----
  app.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("data: {\"type\":\"connected\",\"detail\":\"SSE connected\"}\n\n");
    addClient(res);
    const interval = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { clearInterval(interval); }
    }, 30000);
    req.on("close", () => clearInterval(interval));
  });

  // ---- Settings ----
  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings || {
        providerType: "ollama",
        baseUrl: "http://localhost",
        port: 11434,
        model: "",
        temperature: "0.7",
        maxTokens: 2048,
        safetyMode: "readonly",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const saved = await storage.upsertSettings(req.body);
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Provider: check ----
  app.post("/api/providers/check", async (req, res) => {
    try {
      const { providerType, baseUrl, port } = req.body;
      const result = await checkProvider({
        providerType: providerType || "ollama",
        baseUrl: baseUrl || "http://localhost",
        port: port || 11434,
        model: "",
        temperature: 0.7,
        maxTokens: 2048,
      });
      res.json(result);
    } catch (err: any) {
      res.json({ ok: false, message: err.message });
    }
  });

  // ---- Provider: models ----
  app.post("/api/providers/models", async (req, res) => {
    try {
      const { providerType, baseUrl, port } = req.body;
      const models = await listModels({
        providerType: providerType || "ollama",
        baseUrl: baseUrl || "http://localhost",
        port: port || 11434,
        model: "",
        temperature: 0.7,
        maxTokens: 2048,
      });
      res.json({ models });
    } catch (err: any) {
      res.json({ models: [], error: err.message });
    }
  });

  // ---- Chat: test ----
  app.post("/api/chat/test", async (req, res) => {
    try {
      const { providerType, baseUrl, port, model, temperature, maxTokens } = req.body;
      const response = await chat(
        {
          providerType: providerType || "ollama",
          baseUrl: baseUrl || "http://localhost",
          port: port || 11434,
          model: model || "",
          temperature: parseFloat(temperature) || 0.7,
          maxTokens: parseInt(maxTokens) || 2048,
        },
        [
          { role: "system", content: "Ты — помощник Local Comet. Отвечай кратко на русском." },
          { role: "user", content: "Привет! Подтверди, что ты работаешь. Ответь одним предложением." },
        ]
      );
      res.json({ ok: true, response });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  // ---- Demo scenarios ----
  app.get("/api/agent/demo-scenarios", (_req, res) => {
    res.json(DEMO_SCENARIOS);
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ITERATION 6: Workspaces
  // ──────────────────────────────────────────────────────────────────────────────

  app.get("/api/workspaces", async (_req, res) => {
    try {
      const list = await storage.getWorkspaces();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/workspaces", async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Требуется name" });
      const ws = await storage.createWorkspace({
        name,
        description: description || "",
        isActive: 0,
      });
      res.json(ws);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/workspaces/active", async (_req, res) => {
    try {
      const ws = await storage.getActiveWorkspace();
      res.json(ws || null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/workspaces/:id/activate", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const ws = await storage.setActiveWorkspace(id);
      if (!ws) return res.status(404).json({ error: "Workspace не найден" });
      res.json(ws);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ITERATION 6: Session Tabs
  // ──────────────────────────────────────────────────────────────────────────────

  app.get("/api/tabs", async (req, res) => {
    try {
      const workspaceId = parseInt(req.query.workspaceId as string) || 1;
      const sessionId = (req.query.sessionId as string) || "default";
      const tabs = await storage.getTabsBySession(workspaceId, sessionId);
      res.json(tabs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tabs", async (req, res) => {
    try {
      const { workspaceId, sessionId, label, url } = req.body;
      const tab = await storage.createTab({
        workspaceId: workspaceId || 1,
        sessionId: sessionId || "default",
        label: label || "Новая вкладка",
        url: url || "",
        isActive: 0,
        previewState: "{}",
        snapshotJson: null,
        selectedElement: null,
        historyJson: "[]",
      });
      res.json(tab);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tabs/:id/activate", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const tab = await storage.getTab(id);
      if (!tab) return res.status(404).json({ error: "Tab не найден" });
      await storage.setActiveTab(tab.workspaceId, tab.sessionId, id);
      const updated = await storage.getTab(id);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/tabs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      const updated = await storage.updateTab(id, updates);
      if (!updated) return res.status(404).json({ error: "Tab не найден" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ITERATION 6: Export
  // ──────────────────────────────────────────────────────────────────────────────

  app.get("/api/export/session", async (req, res) => {
    try {
      const workspaceId = parseInt(req.query.workspaceId as string) || 1;
      const sessionId = (req.query.sessionId as string) || "default";
      const data = await storage.exportSession(workspaceId, sessionId);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="session-${sessionId}-export.json"`);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/export/task/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = await storage.exportTask(id);
      if (!data) return res.status(404).json({ error: "Задача не найдена" });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="task-${id}-export.json"`);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // ITERATION 6: Session Inspector
  // ──────────────────────────────────────────────────────────────────────────────

  app.get("/api/inspector", async (req, res) => {
    try {
      const workspaceId = parseInt(req.query.workspaceId as string) || 1;
      const sessionId = (req.query.sessionId as string) || "default";
      
      const workspace = await storage.getWorkspace(workspaceId);
      const tabs = await storage.getTabsBySession(workspaceId, sessionId);
      const activeTab = tabs.find(t => t.isActive === 1);
      const state = getSessionState(sessionId);
      const tasks = await storage.getTasksBySession(sessionId);

      res.json({
        workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
        sessionId,
        activeTab: activeTab ? {
          id: activeTab.id,
          label: activeTab.label,
          url: activeTab.url,
        } : null,
        tabCount: tabs.length,
        preview: {
          url: state.preview.url,
          syncId: state.preview.syncId,
          hasScreenshot: !!state.preview.screenshotBase64,
        },
        snapshot: {
          elementCount: state.preview.snapshot?.elements?.length || 0,
          title: state.preview.snapshot?.title || "",
        },
        selectedElement: state.selectedElement ? {
          type: state.selectedElement.type,
          text: state.selectedElement.text,
        } : null,
        taskCount: tasks.length,
        stepCount: tasks.reduce((sum, t) => {
          try { return sum + JSON.parse(t.plan || "[]").length; } catch { return sum; }
        }, 0),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Existing routes (v5) — kept intact
  // ──────────────────────────────────────────────────────────────────────────────

  // ---- Agent: plan (kept for backward compat) ----
  app.post("/api/agent/plan", async (req, res) => {
    try {
      const { url, goal } = req.body;
      if (!url || !goal) {
        return res.status(400).json({ error: "Требуются url и goal" });
      }
      const settings = await storage.getSettings();
      let modelPlan: any[] | null = null;
      if (settings?.model) {
        modelPlan = await requestPlanFromModel(
          {
            providerType: settings.providerType,
            baseUrl: settings.baseUrl,
            port: settings.port,
            model: settings.model,
            temperature: parseFloat(settings.temperature),
            maxTokens: settings.maxTokens,
          },
          goal,
          url
        );
      }
      const plan = modelPlan || generateFallbackPlan(goal, url);
      const usedModel = modelPlan ? true : false;
      res.json({
        plan,
        source: usedModel ? "model" : "fallback",
        message: usedModel
          ? "План сгенерирован моделью"
          : "План сгенерирован эвристически (модель недоступна или не настроена)",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Agent: run (v6 — workspace-aware) ----
  app.post("/api/agent/run", async (req, res) => {
    try {
      const { url, goal, maxSteps, sessionId, workspaceId } = req.body;
      if (!url || !goal) {
        return res.status(400).json({ error: "Требуются url и goal" });
      }

      const settings = await storage.getSettings();
      const safetyMode = settings?.safetyMode || "readonly";
      const sid = sessionId || `session-${Date.now()}`;
      const wsId = workspaceId || (await storage.getActiveWorkspace())?.id || 1;

      // Create task with session + workspace
      const task = await storage.createTask({
        title: goal.slice(0, 100),
        targetUrl: url,
        goal,
        sessionId: sid,
        workspaceId: wsId,
      });

      // Build provider config
      let providerConfig = null;
      if (settings?.model) {
        providerConfig = {
          providerType: settings.providerType,
          baseUrl: settings.baseUrl,
          port: settings.port,
          model: settings.model,
          temperature: parseFloat(settings.temperature),
          maxTokens: settings.maxTokens,
        };
      }

      // Enqueue the task
      await enqueueTask(task, {
        maxSteps: maxSteps || DEFAULT_MAX_STEPS,
        providerConfig,
        safetyMode,
      });

      res.json({
        task,
        queued: true,
        sessionId: sid,
        workspaceId: wsId,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Queue status ----
  app.get("/api/queue", async (_req, res) => {
    try {
      const status = await getQueueStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Cancel task ----
  app.post("/api/queue/cancel", async (req, res) => {
    try {
      const { taskId } = req.body;
      const cancelled = await cancelTask(taskId);
      res.json({ ok: cancelled });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Sessions (workspace-aware) ----
  app.get("/api/sessions", async (req, res) => {
    try {
      const workspaceId = parseInt(req.query.workspaceId as string) || 0;
      const sessions = workspaceId
        ? await storage.getSessionsByWorkspace(workspaceId)
        : await storage.getSessions();
      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sessions/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const tasks = await storage.getTasksBySession(sessionId);
      const state = getSessionState(sessionId);
      res.json({
        sessionId,
        tasks,
        preview: {
          url: state.preview.url,
          syncId: state.preview.syncId,
          timestamp: state.preview.timestamp,
          currentAction: state.preview.currentAction,
          hasScreenshot: !!state.preview.screenshotBase64,
          snapshot: state.preview.snapshot,
        },
        selectedElement: state.selectedElement,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Confirm: respond to a pending confirm ----
  app.post("/api/agent/confirm", (req, res) => {
    try {
      const { taskId, approved } = req.body;
      if (taskId === undefined || approved === undefined) {
        return res.status(400).json({ error: "Требуются taskId и approved" });
      }
      const resolved = resolveConfirm(taskId, !!approved);
      if (!resolved) {
        return res.status(404).json({ error: "Нет ожидающего подтверждения для этой задачи" });
      }
      res.json({ ok: true, approved: !!approved });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Confirm: check status ----
  app.get("/api/agent/confirm/status", (_req, res) => {
    const pending = getPendingConfirm();
    if (pending) {
      res.json({
        pending: true,
        taskId: pending.taskId,
        sessionId: pending.sessionId,
        step: pending.step,
        action: pending.action,
        riskLevel: pending.riskLevel,
        riskReason: pending.reason,
      });
    } else {
      res.json({ pending: false });
    }
  });

  // ---- Preview: get current preview state (session-aware) ----
  app.get("/api/preview", (req, res) => {
    try {
      const sessionId = (req.query.sessionId as string) || "default";
      const preview = getPreviewState(sessionId);
      res.json({
        sessionId,
        url: preview.url,
        syncId: preview.syncId,
        timestamp: preview.timestamp,
        currentAction: preview.currentAction,
        hasScreenshot: !!preview.screenshotBase64,
        snapshot: preview.snapshot,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Preview: get screenshot image (session-aware) ----
  app.get("/api/preview/screenshot", async (req, res) => {
    try {
      const sessionId = (req.query.sessionId as string) || "default";
      const preview = getPreviewState(sessionId);
      if (preview.screenshotBase64) {
        const buffer = Buffer.from(preview.screenshotBase64, "base64");
        res.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Content-Length": buffer.length,
          "Cache-Control": "no-cache",
        });
        res.end(buffer);
      } else {
        res.status(404).json({ error: "Скриншот не доступен" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Preview: refresh ----
  app.post("/api/preview/refresh", async (req, res) => {
    try {
      await initBrowser();
      const screenshot = await takeScreenshot();
      if (screenshot) {
        res.json({ ok: true, hasScreenshot: true, timestamp: new Date().toISOString() });
      } else {
        res.json({ ok: false, error: "Не удалось сделать скриншот" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Manual action: execute from UI ----
  app.post("/api/action/execute", async (req, res) => {
    try {
      const { action, params, sessionId } = req.body;
      if (!action) {
        return res.status(400).json({ error: "Требуется action" });
      }

      const settings = await storage.getSettings();
      const safetyMode = settings?.safetyMode || "readonly";
      const sid = sessionId || "default";

      const agentAction: AgentAction = { action, params: params || {} };
      const result = await executeManualAction(agentAction, safetyMode, sid);

      await storage.addLog({
        taskId: 0,
        sessionId: sid,
        workspaceId: 1,
        stepIndex: 0,
        action: `manual:${action}`,
        detail: result.detail,
        status: result.status === "blocked" || result.status === "skipped" ? "warning" : result.status,
        timestamp: new Date().toISOString(),
      });

      const preview = getPreviewState(sid);
      res.json({
        result,
        preview: {
          sessionId: sid,
          url: preview.url,
          syncId: preview.syncId,
          timestamp: preview.timestamp,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Selected element: set from UI (session-aware) ----
  app.post("/api/element/select", (req, res) => {
    try {
      const { element, sessionId } = req.body;
      const sid = sessionId || "default";
      setSelectedElement(sid, element || null);
      res.json({ ok: true, selected: element || null, sessionId: sid });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Selected element: get current (session-aware) ----
  app.get("/api/element/selected", (req, res) => {
    const sessionId = (req.query.sessionId as string) || "default";
    res.json({ element: getSelectedElement(sessionId), sessionId });
  });

  // ---- Tasks history (workspace-aware) ----
  app.get("/api/tasks", async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string | undefined;
      const workspaceId = parseInt(req.query.workspaceId as string) || 0;
      
      if (sessionId) {
        const tasks = await storage.getTasksBySession(sessionId);
        return res.json(tasks);
      }
      if (workspaceId) {
        const tasks = await storage.getTasksByWorkspace(workspaceId);
        return res.json(tasks);
      }
      const tasks = await storage.getTasks();
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const task = await storage.getTask(id);
      if (!task) return res.status(404).json({ error: "Задача не найдена" });
      const logs = await storage.getLogsForTask(id);
      res.json({ task, logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Step snapshots for replay ----
  app.get("/api/tasks/:id/steps", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const steps = await storage.getStepSnapshots(id);
      // Return steps without large screenshot data for list view
      const lightSteps = steps.map(s => ({
        id: s.id,
        taskId: s.taskId,
        sessionId: s.sessionId,
        stepIndex: s.stepIndex,
        phase: s.phase,
        action: s.action,
        status: s.status,
        detail: s.detail,
        timestamp: s.timestamp,
        hasScreenshot: !!s.screenshotBase64,
        snapshotJson: s.snapshotJson,
      }));
      res.json(lightSteps);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Step screenshot for replay ----
  app.get("/api/tasks/:id/steps/:stepIndex/screenshot", async (req, res) => {
    try {
      const taskId = parseInt(req.params.id);
      const stepIndex = parseInt(req.params.stepIndex);
      const steps = await storage.getStepSnapshots(taskId);
      const step = steps.find(s => s.stepIndex === stepIndex);
      if (step?.screenshotBase64) {
        const buffer = Buffer.from(step.screenshotBase64, "base64");
        res.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Content-Length": buffer.length,
          "Cache-Control": "no-cache",
        });
        res.end(buffer);
      } else {
        res.status(404).json({ error: "Скриншот не доступен для этого шага" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Terminal / Shell ──────────────────────────────────────────────────────

  /** Execute a shell command in the session sandbox directory */
  app.post("/api/terminal/exec", async (req, res) => {
    try {
      const { command, sessionId, timeout } = req.body;
      if (!command || typeof command !== "string") {
        return res.status(400).json({ error: "Требуется команда" });
      }
      const sid = sessionId || "default";
      const result = await executeTerminalCommand(command.trim(), sid, timeout || 10_000);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** List files in session sandbox */
  app.get("/api/terminal/files", (req, res) => {
    try {
      const sid = (req.query.sessionId as string) || "default";
      const files = listSandboxFiles(sid);
      const cwd = getSandboxDir(sid);
      res.json({ files, cwd });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Read a sandbox file */
  app.get("/api/terminal/files/:filename", (req, res) => {
    try {
      const sid = (req.query.sessionId as string) || "default";
      const content = readSandboxFile(sid, req.params.filename);
      res.json({ content, filename: req.params.filename });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  /** Write a sandbox file */
  app.post("/api/terminal/files", (req, res) => {
    try {
      const { filename, content, sessionId } = req.body;
      if (!filename || !content === undefined) {
        return res.status(400).json({ error: "Требуются filename и content" });
      }
      const sid = sessionId || "default";
      writeSandboxFile(sid, filename, content || "");
      res.json({ ok: true, filename });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Code Sandbox ──────────────────────────────────────────────────────────

  /** Run code in language sandbox (JS/Python/Bash) */
  app.post("/api/sandbox/run", async (req, res) => {
    try {
      const { code, language, sessionId, timeout } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Требуется code" });
      }
      const lang = (language || "javascript") as CodeLanguage;
      const validLangs: CodeLanguage[] = ["javascript", "typescript", "python", "bash"];
      if (!validLangs.includes(lang)) {
        return res.status(400).json({ error: `Недопустимый язык: ${lang}. Допустимые: ${validLangs.join(", ")}` });
      }
      const sid = sessionId || "default";
      const result = await runCodeSandbox(code, lang, sid, timeout || 10_000);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Computer flow: natural-language → agent run ──────────────────────────

  /**
   * POST /api/computer/run
   * Body: { query: string, sessionId?: string, workspaceId?: number }
   * 
   * Accepts a free-form natural language query, resolves URL from intent
   * (using the same logic as the frontend intent-parser but on server side),
   * and enqueues an agent task automatically.
   * 
   * Unlike /api/agent/run which requires explicit url + goal,
   * this endpoint handles the full "user types → agent acts" flow.
   */
  app.post("/api/computer/run", async (req, res) => {
    try {
      const { query, sessionId, workspaceId, maxSteps } = req.body;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Требуется query" });
      }

      const settings = await storage.getSettings();
      const safetyMode = settings?.safetyMode || "readonly";
      const sid = sessionId || `session-${Date.now()}`;
      const wsId = workspaceId || (await storage.getActiveWorkspace())?.id || 1;

      // Resolve URL + goal from natural language query
      const { url, goal } = resolveComputerQuery(query);
      const queryType = detectQueryType(query);

      // Generate a heuristic plan immediately so the UI can show steps before execution
      const heuristicPlan = generateFallbackPlan(goal, url);

      // Try to get a model-based plan if provider is configured
      let providerConfig: any = null;
      let modelPlan: any[] | null = null;
      if (settings?.model) {
        providerConfig = {
          providerType: settings.providerType,
          baseUrl: settings.baseUrl,
          port: settings.port,
          model: settings.model,
          temperature: parseFloat(settings.temperature),
          maxTokens: settings.maxTokens,
        };
        // Non-blocking: attempt model plan, fall back silently
        modelPlan = await requestPlanFromModel(providerConfig, goal, url).catch(() => null);
      }

      const plan = modelPlan || heuristicPlan;
      const planSource = modelPlan ? "model" : "heuristic";

      // Build human-readable step descriptions
      const planSteps: Array<{ index: number; action: string; description: string; status: "pending" }> =
        plan.map((step: any, i: number) => ({
          index: i,
          action: step.action,
          description: describeAction(step),
          status: "pending" as const,
        }));

      const task = await storage.createTask({
        title: query.slice(0, 100),
        targetUrl: url,
        goal,
        sessionId: sid,
        workspaceId: wsId,
      });

      await enqueueTask(task, {
        maxSteps: maxSteps || DEFAULT_MAX_STEPS,
        providerConfig,
        safetyMode,
      });

      res.json({
        task,
        queued: true,
        sessionId: sid,
        workspaceId: wsId,
        resolvedUrl: url,
        goal,
        queryType,
        planSteps,
        planSource,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Kwork Lead Scoring Workflow
  // ──────────────────────────────────────────────────────────────────────────────

  /** GET /api/kwork/leads — list all leads */
  app.get("/api/kwork/leads", async (_req, res) => {
    try {
      const leads = await storage.getKworkLeads();
      res.json(leads);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** GET /api/kwork/leads/:id — single lead */
  app.get("/api/kwork/leads/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const lead = await storage.getKworkLead(id);
      if (!lead) return res.status(404).json({ error: "Лид не найден" });
      res.json(lead);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/kwork/leads — create lead with auto-scoring */
  app.post("/api/kwork/leads", async (req, res) => {
    try {
      const body = req.body;
      if (!body.title) return res.status(400).json({ error: "Требуется title" });

      // Auto-score
      const scoring = scoreKworkLead({
        budget: body.budget || 0,
        brief: body.brief || "",
        category: body.category || "",
        title: body.title || "",
        flagFitsProfile: !!(body.flagFitsProfile),
        flagNeedsCall: !!(body.flagNeedsCall),
        flagNeedsAccess: !!(body.flagNeedsAccess),
        flagNeedsDesign: !!(body.flagNeedsDesign),
        flagNeedsMobile: !!(body.flagNeedsMobile),
        flagCloudVmFit: !!(body.flagCloudVmFit),
      });

      const lead = await storage.createKworkLead({
        source: body.source || "manual",
        sourceRaw: body.sourceRaw || "",
        title: body.title,
        budget: body.budget || 0,
        budgetRaw: body.budgetRaw || `${(body.budget || 0).toLocaleString("ru-RU")} ₽`,
        orderUrl: body.orderUrl || null,
        brief: body.brief || "",
        category: body.category || "",
        flagFitsProfile: body.flagFitsProfile ? 1 : 0,
        flagNeedsCall: body.flagNeedsCall ? 1 : 0,
        flagNeedsAccess: body.flagNeedsAccess ? 1 : 0,
        flagNeedsDesign: body.flagNeedsDesign ? 1 : 0,
        flagNeedsMobile: body.flagNeedsMobile ? 1 : 0,
        flagCloudVmFit: body.flagCloudVmFit ? 1 : 0,
        fitScore: scoring.fitScore,
        recommendation: scoring.recommendation,
        whyFits: JSON.stringify(scoring.whyFits),
        keyRisks: JSON.stringify(scoring.keyRisks),
        status: "new",
        receivedAt: body.receivedAt || new Date().toISOString(),
      });
      res.json(lead);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** PATCH /api/kwork/leads/:id — update lead (status, shortlist, etc) */
  app.patch("/api/kwork/leads/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      const updated = await storage.updateKworkLead(id, updates);
      if (!updated) return res.status(404).json({ error: "Лид не найден" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** DELETE /api/kwork/leads/:id */
  app.delete("/api/kwork/leads/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteKworkLead(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/kwork/leads/:id/rescore — recalculate score */
  app.post("/api/kwork/leads/:id/rescore", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const lead = await storage.getKworkLead(id);
      if (!lead) return res.status(404).json({ error: "Лид не найден" });

      const scoring = scoreKworkLead({
        budget: lead.budget,
        brief: lead.brief,
        category: lead.category,
        title: lead.title,
        flagFitsProfile: lead.flagFitsProfile === 1,
        flagNeedsCall: lead.flagNeedsCall === 1,
        flagNeedsAccess: lead.flagNeedsAccess === 1,
        flagNeedsDesign: lead.flagNeedsDesign === 1,
        flagNeedsMobile: lead.flagNeedsMobile === 1,
        flagCloudVmFit: lead.flagCloudVmFit === 1,
      });

      const updated = await storage.updateKworkLead(id, {
        fitScore: scoring.fitScore,
        recommendation: scoring.recommendation,
        whyFits: JSON.stringify(scoring.whyFits),
        keyRisks: JSON.stringify(scoring.keyRisks),
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/kwork/leads/:id/open — mark as opened and optionally start agent task */
  app.post("/api/kwork/leads/:id/open", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const lead = await storage.getKworkLead(id);
      if (!lead) return res.status(404).json({ error: "Лид не найден" });

      await storage.updateKworkLead(id, { status: "opened" });

      res.json({
        ok: true,
        leadId: id,
        orderUrl: lead.orderUrl,
        title: lead.title,
        canOpenDirectly: !!lead.orderUrl,
        message: lead.orderUrl
          ? `Открыть заказ: ${lead.orderUrl}`
          : "URL заказа недоступен — лид получен из email-дайджеста. Откройте kwork.ru и найдите проект вручную.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/kwork/leads/:id/computer-review — launch Computer agent task for this lead */
  app.post("/api/kwork/leads/:id/computer-review", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const lead = await storage.getKworkLead(id);
      if (!lead) return res.status(404).json({ error: "Лид не найден" });

      const targetUrl = lead.orderUrl || `https://kwork.ru/projects?search=${encodeURIComponent(lead.title)}`;
      const settings = await storage.getSettings();
      const wsId = (await storage.getActiveWorkspace())?.id || 1;
      const sid = `kwork-${id}-${Date.now()}`;

      const task = await storage.createTask({
        title: `Kwork Review: ${lead.title.slice(0, 80)}`,
        targetUrl,
        goal: `Открыть страницу Kwork-заказа и извлечь полное ТЗ, требования, сроки и условия для проекта: "${lead.title}". Бюджет: ${lead.budget.toLocaleString("ru-RU")} ₽.`,
        sessionId: sid,
        workspaceId: wsId,
      });

      let providerConfig: any = null;
      if (settings?.model) {
        providerConfig = {
          providerType: settings.providerType,
          baseUrl: settings.baseUrl,
          port: settings.port,
          model: settings.model,
          temperature: parseFloat(settings.temperature),
          maxTokens: settings.maxTokens,
        };
      }

      const { enqueueTask } = await import("./task-queue");
      await enqueueTask(task, {
        maxSteps: 8,
        providerConfig,
        safetyMode: settings?.safetyMode || "readonly",
      });

      await storage.updateKworkLead(id, {
        status: "in_review",
        computerTaskId: task.id,
      });

      res.json({
        ok: true,
        task,
        sessionId: sid,
        leadId: id,
        targetUrl,
        message: lead.orderUrl
          ? "Computer-агент запущен для анализа страницы заказа"
          : "Computer-агент запущен для поиска заказа на Kwork (URL неизвестен — поиск по названию)",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/kwork/seed — seed demo data */
  app.post("/api/kwork/seed", async (_req, res) => {
    try {
      await storage.seedKworkLeads();
      const leads = await storage.getKworkLeads();
      res.json({ ok: true, count: leads.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/kwork/score-preview — score without saving */
  app.post("/api/kwork/score-preview", (req, res) => {
    try {
      const body = req.body;
      const result = scoreKworkLead({
        budget: body.budget || 0,
        brief: body.brief || "",
        category: body.category || "",
        title: body.title || "",
        flagFitsProfile: !!(body.flagFitsProfile),
        flagNeedsCall: !!(body.flagNeedsCall),
        flagNeedsAccess: !!(body.flagNeedsAccess),
        flagNeedsDesign: !!(body.flagNeedsDesign),
        flagNeedsMobile: !!(body.flagNeedsMobile),
        flagCloudVmFit: !!(body.flagCloudVmFit),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cleanup on server shutdown
  process.on("SIGTERM", async () => { await closeBrowser(); });
  process.on("SIGINT", async () => { await closeBrowser(); });

  return httpServer;
}

// ── Server-side intent resolution (mirrors frontend intent-parser) ────────────

const KNOWN_SITES: Record<string, string> = {
  google: "https://www.google.com",
  гугл: "https://www.google.com",
  youtube: "https://www.youtube.com",
  ютуб: "https://www.youtube.com",
  github: "https://github.com",
  гитхаб: "https://github.com",
  grok: "https://grok.com",
  перплексити: "https://www.perplexity.ai",
  perplexity: "https://www.perplexity.ai",
  twitter: "https://x.com",
  reddit: "https://www.reddit.com",
  реддит: "https://www.reddit.com",
  wikipedia: "https://ru.wikipedia.org",
  вики: "https://ru.wikipedia.org",
  "hacker news": "https://news.ycombinator.com",
  hackernews: "https://news.ycombinator.com",
  hn: "https://news.ycombinator.com",
  habr: "https://habr.com",
  хабр: "https://habr.com",
  gmail: "https://mail.google.com",
  яндекс: "https://ya.ru",
  yandex: "https://ya.ru",
  stackoverflow: "https://stackoverflow.com",
  chatgpt: "https://chatgpt.com",
  claude: "https://claude.ai",
};

const SEARCH_ENGINES: Record<string, string> = {
  google: "https://www.google.com/search?q={q}",
  гугл: "https://www.google.com/search?q={q}",
  youtube: "https://www.youtube.com/results?search_query={q}",
  ютуб: "https://www.youtube.com/results?search_query={q}",
  github: "https://github.com/search?q={q}",
  reddit: "https://www.reddit.com/search/?q={q}",
  wikipedia: "https://ru.wikipedia.org/w/index.php?search={q}",
  яндекс: "https://yandex.ru/search/?text={q}",
  yandex: "https://yandex.ru/search/?text={q}",
  stackoverflow: "https://stackoverflow.com/search?q={q}",
  perplexity: "https://www.perplexity.ai/search?q={q}",
};

const URL_RE = /^(?:https?:\/\/)?[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(?:[\/\w\-.~:?#[\]@!$&'()*+,;=]*)?$/i;

function resolveComputerQuery(query: string): { url: string; goal: string } {
  const raw = query.trim();
  const lower = raw.toLowerCase();

  // 1) Search patterns: "найди в google X", "find on github X"
  const searchPatterns = [
    /^(?:найди|найти|поиск|ищи|искать|search|find|погугли|загугли)\s+(?:в|on|in|at)\s+(\S+)\s+(.+)$/i,
    /^(?:найди|найти|поиск|ищи|искать|search|find|погугли|загугли)\s+(.+)$/i,
  ];
  for (const pat of searchPatterns) {
    const m = raw.match(pat);
    if (m) {
      if (m.length === 3) {
        const engName = m[1].toLowerCase();
        const engTpl = SEARCH_ENGINES[engName];
        if (engTpl) {
          const url = engTpl.replace("{q}", encodeURIComponent(m[2].trim()));
          return { url, goal: `Найти: ${m[2].trim()}` };
        }
      }
      const q = (m[1] || m[2] || "").trim();
      const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      return { url, goal: `Поиск в Google: ${q}` };
    }
  }

  // 2) Open patterns: "открой google", "open github"
  const openPatterns = [
    /^(?:открой|открыть|зайди на|перейди на|go to|open|launch)\s+(?:сайт\s+)?(.+)$/i,
  ];
  for (const pat of openPatterns) {
    const m = raw.match(pat);
    if (m) {
      const target = m[1].trim().toLowerCase();
      if (KNOWN_SITES[target]) {
        return { url: KNOWN_SITES[target], goal: `Открыть ${target} и изучить страницу` };
      }
      if (URL_RE.test(m[1].trim())) {
        const u = m[1].trim().startsWith("http") ? m[1].trim() : `https://${m[1].trim()}`;
        return { url: u, goal: `Изучить страницу ${u}` };
      }
    }
  }

  // 3) Bare known site
  if (KNOWN_SITES[lower]) {
    return { url: KNOWN_SITES[lower], goal: `Открыть ${lower} и изучить страницу` };
  }

  // 4) Bare URL
  if (URL_RE.test(raw)) {
    const u = raw.startsWith("http") ? raw : `https://${raw}`;
    return { url: u, goal: `Изучить страницу ${u}` };
  }

  // 5) Anything with a recognizable site name + action (e.g. "посмотри что нового на habr")
  for (const [name, url] of Object.entries(KNOWN_SITES)) {
    if (lower.includes(name)) {
      return { url, goal: raw };
    }
  }

  // 6) Fallback: treat as general goal on Google search
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
  return { url: searchUrl, goal: raw };
}

function detectQueryType(query: string): string {
  const lower = query.toLowerCase();
  if (/найди|поиск|search|find/i.test(lower)) return "search";
  if (/открой|зайди|open|go to|launch/i.test(lower)) return "open_site";
  if (URL_RE.test(query.trim())) return "navigate_url";
  return "agent_task";
}

/**
 * Generate a human-readable description for a plan step action.
 */
function describeAction(step: { action: string; params?: Record<string, string> }): string {
  const p = step.params || {};
  switch (step.action) {
    case "navigate":   return `Открыть ${p.url || "страницу"}`;
    case "dom_snapshot": return "Сканировать структуру страницы";
    case "read_title": return "Прочитать заголовок страницы";
    case "extract_text": return "Извлечь текст страницы";
    case "find_links": return "Найти ссылки на странице";
    case "find_buttons": return "Найти кнопки и элементы управления";
    case "click_link": return p.text ? `Нажать: «${p.text}»` : "Нажать на ссылку";
    case "fill_input": return p.placeholder ? `Заполнить поле «${p.placeholder}»` : "Заполнить поле ввода";
    case "summarize_page": return "Составить сводку страницы";
    default:           return step.action;
  }
}
