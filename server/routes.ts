import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { checkProvider, listModels, chat, requestPlanFromModel } from "./provider-gateway";
import {
  closeBrowser, generateFallbackPlan, resolveConfirm, getPendingConfirm,
  executeManualAction, getPreviewState, takeScreenshot, setSelectedElement, getSelectedElement,
  initBrowser, getSessionState, isBrowserBusy, probeChromiumAvailable,
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

const DEFAULT_MAX_STEPS = 15; // Increased: search tasks need navigate + dom_snapshot + fill_input + navigate + extract_text + find_links + summarize = 7+ steps

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
      browserBusy: isBrowserBusy(),
    });
  });

  // ---- Runtime status (computer + provider) ----
  app.get("/api/computer/status", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      const queueStatus = await getQueueStatus();

      // Check provider availability if configured
      let providerStatus: { ok: boolean; status: string; message: string } | null = null;
      if (settings?.model && settings?.providerType) {
        try {
          providerStatus = await checkProvider({
            providerType: settings.providerType,
            baseUrl: settings.baseUrl,
            port: settings.port,
            model: settings.model,
            apiKey: settings.apiKey || "",
            temperature: parseFloat(settings.temperature),
            maxTokens: settings.maxTokens,
          });
        } catch (e: any) {
          providerStatus = { ok: false, status: "error", message: e.message };
        }
      }

      // Probe Chromium binary availability (cached after first call)
      const chromiumAvailable = await probeChromiumAvailable();

      res.json({
        browserBusy: isBrowserBusy(),
        queue: {
          isProcessing: queueStatus.isProcessing,
          runningTaskId: queueStatus.runningTask?.id ?? null,
          queuedCount: queueStatus.queuedTasks.length,
        },
        provider: settings ? {
          type: settings.providerType,
          model: settings.model || null,
          configured: !!settings.model,
          availability: providerStatus,
        } : null,
        capabilities: {
          terminalExec: true,
          codeSandbox: true,
          browserAgent: chromiumAvailable,
          /** chromiumAvailable: Playwright Chromium binary found on disk */
          chromiumAvailable,
          /**
           * browserAvailable: Chromium is installed AND not currently busy.
           * When busy, agent tasks are queued and will execute sequentially.
           */
          browserAvailable: chromiumAvailable && !isBrowserBusy(),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
        baseUrl: "http://127.0.0.1",
        port: 11436,
        model: "",
        apiKey: "",
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
      const { providerType, baseUrl, port, apiKey, model } = req.body;
      const result = await checkProvider({
        providerType: providerType || "ollama",
        baseUrl: baseUrl || "http://127.0.0.1",
        port: port || 11436,
        model: model || "",
        apiKey: apiKey || "",
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
      const { providerType, baseUrl, port, apiKey, model } = req.body;
      const models = await listModels({
        providerType: providerType || "ollama",
        baseUrl: baseUrl || "http://127.0.0.1",
        port: port || 11436,
        model: model || "",
        apiKey: apiKey || "",
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
      const { providerType, baseUrl, port, model, apiKey, temperature, maxTokens } = req.body;
      const response = await chat(
        {
          providerType: providerType || "ollama",
          baseUrl: baseUrl || "http://127.0.0.1",
          port: port || 11436,
          model: model || "",
          apiKey: apiKey || "",
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
            apiKey: settings.apiKey || "",
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

      // Fast-fail: reject browser tasks when Chromium binary is missing
      const chromiumReady = await probeChromiumAvailable();
      if (!chromiumReady) {
        return res.status(503).json({
          ok: false,
          error: "browser_unavailable",
          message: "Браузер (Chromium) недоступен — запустите `npx playwright install chromium` для установки браузера.",
        });
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
          apiKey: settings.apiKey || "",
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
      if (!filename || content === undefined || content === null) {
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

  // ── Code Formatter ─────────────────────────────────────────────────────────

  /**
   * POST /api/sandbox/format
   * Body: { code: string, language: string }
   *
   * Formats code using basic server-side rules.
   * For Python: normalizes indentation and trailing whitespace.
   * For JS/TS: basic cleanup.
   * Returns { formatted: string } on success.
   */
  app.post("/api/sandbox/format", async (req, res) => {
    try {
      const { code, language } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Требуется code" });
      }

      const lang = (language || "javascript") as string;
      let formatted = code;

      if (lang === "python") {
        // Basic Python: normalize trailing whitespace, ensure newline at end
        formatted = code
          .split("\n")
          .map((line: string) => line.trimEnd())
          .join("\n")
          .trimEnd() + "\n";
      } else if (lang === "html") {
        // Basic HTML: trim trailing whitespace per line
        formatted = code
          .split("\n")
          .map((line: string) => line.trimEnd())
          .join("\n")
          .trimEnd() + "\n";
      } else {
        // JS/TS/CSS/bash: just clean trailing whitespace
        formatted = code
          .split("\n")
          .map((line: string) => line.trimEnd())
          .join("\n")
          .trimEnd() + "\n";
      }

      res.json({ formatted, language: lang, ok: true });
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
  /**
   * POST /api/computer/code
   * Body: { query: string, sessionId?: string, language?: string }
   *
   * Handles code-writing / code-running requests via the local sandbox.
   * Tries LLM generation first, falls back to template.
   * The response includes the generated code and sandbox execution result.
   * This is the "local code path" — no browser is opened.
   */
  app.post("/api/computer/code", async (req, res) => {
    try {
      const { query, sessionId, language: requestedLang } = req.body;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Требуется query" });
      }
      const sid = sessionId || `session-${Date.now()}`;
      const lang = (requestedLang && ["python", "javascript", "typescript", "bash", "html", "css"].includes(requestedLang)
        ? requestedLang
        : detectCodeLanguage(query)) as "python" | "javascript" | "typescript" | "bash" | "html" | "css";

      const lower = query.toLowerCase();
      let code: string | null = null;
      let generationSource = "template";

      // ── Fast deterministic path — skip LLM for template-matched queries ──────
      // isTemplateOnlyRequest() returns true when generateCodeTemplate() will
      // produce a high-quality result, so there is no reason to wait for an LLM.
      if (!isTemplateOnlyRequest(lower)) {
        // ── Try LLM generation with a hard 8-second timeout ────────────────────
        try {
          const settings = await storage.getSettings();
          if (settings?.model && settings.model.trim().length > 0) {
            const providerConfig = {
              providerType: settings.providerType,
              baseUrl: settings.baseUrl,
              port: settings.port,
              model: settings.model,
              apiKey: settings.apiKey || "",
              temperature: parseFloat(settings.temperature) || 0.2,
              maxTokens: Math.min(settings.maxTokens || 1024, 2048),
            };
            const langName = lang === "javascript" ? "JavaScript" : lang === "typescript" ? "TypeScript" : lang === "bash" ? "Bash" : lang === "html" ? "HTML" : lang === "css" ? "CSS" : "Python";
            const isWebLangInner = lang === "html" || lang === "css";
            const systemPrompt = isWebLangInner
              ? `You are an expert ${langName} developer. Write ONLY complete, working ${langName} code — no markdown fences, no explanations. For HTML include full page structure with <!DOCTYPE html>. Output raw code only.`
              : `You are an expert ${langName} programmer. Write ONLY runnable code — no markdown fences, no explanations, no comments except inline. Output raw code only. The code must work correctly when executed.`;
            const userMsg = isWebLangInner
              ? `Write complete, working ${langName} for: ${query}\n\nRequirements:\n- Self-contained (all CSS/JS inline for HTML)\n- Visually polished\n- Output raw ${langName} only, no markdown`
              : `Write a complete, runnable ${langName} program that: ${query}\n\nRequirements:\n- Output meaningful results to stdout\n- No external dependencies unless standard library\n- Handle edge cases\n- Output raw code only, no markdown`;

            // Hard timeout: if LLM doesn't respond within 8 s, fall through to template.
            const LLM_TIMEOUT_MS = 8_000;
            const llmResult = await Promise.race([
              chat(providerConfig as any, [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMsg },
              ]),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("llm_timeout")), LLM_TIMEOUT_MS)
              ),
            ]);

            const raw = (llmResult as { content: string }).content.trim();
            // Strip markdown code fences if LLM included them anyway
            const stripped = raw
              .replace(/^```[\w]*\n?/m, "")
              .replace(/\n?```$/m, "")
              .trim();
            if (stripped.length > 5) {
              code = stripped;
              generationSource = "llm";
            }
          }
        } catch (_llmErr) {
          // LLM unavailable, timed out, or failed — fall through to template
        }
      }

      // ── Template fallback (also fast path for template-detectable queries) ───
      if (!code) {
        code = generateCodeTemplate(query, lower, lang);
        generationSource = "template";
      }

      // ── Run the generated code in the sandbox (skip for HTML/CSS) ──────────
      const isWebLang = lang === "html" || lang === "css";
      let sandboxResult: any = null;

      if (!isWebLang) {
        sandboxResult = await runCodeSandbox(code, lang as any, sid, 15_000);
      }

      res.json({
        ok: true,
        queryType: "code_task",
        language: lang,
        code,
        sessionId: sid,
        generationSource,
        sandbox: sandboxResult,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/computer/run", async (req, res) => {
    try {
      const { query, sessionId, workspaceId, maxSteps } = req.body;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Требуется query" });
      }

      // ── Code intent guard — MUST be checked BEFORE Chromium probe ──────────
      // If the query is a code/programming request, short-circuit to local sandbox
      // and never open a browser or navigate to Google/GitHub.
      if (isServerCodeIntent(query)) {
        const sid = sessionId || `session-${Date.now()}`;
        const lang = detectCodeLanguage(query);
        return res.json({
          ok: true,
          queryType: "code_task",
          routedTo: "sandbox",
          language: lang,
          sessionId: sid,
          message: "Запрос перенаправлен в sandbox — используйте вкладку Code.",
        });
      }

      // Fast-fail: reject browser tasks when Chromium binary is missing
      const chromiumReady = await probeChromiumAvailable();
      if (!chromiumReady) {
        return res.status(503).json({
          ok: false,
          error: "browser_unavailable",
          message: "Браузер (Chromium) недоступен — запустите `npx playwright install chromium` для установки браузера.",
        });
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
          apiKey: settings.apiKey || "",
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
        isShortlisted: 0,
        computerTaskId: null,
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
      if (isNaN(id)) return res.status(400).json({ error: "Некорректный id" });

      // Prevent overwriting the id itself
      const { id: _ignoreId, createdAt: _ignoreCreatedAt, ...safeUpdates } = req.body;
      const updated = await storage.updateKworkLead(id, safeUpdates);
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
      if (isNaN(id)) return res.status(400).json({ error: "id должен быть числом" });
      const lead = await storage.getKworkLead(id);
      if (!lead) return res.status(404).json({ error: "Лид не найден" });

      // Fast-fail: if Chromium binary is missing, reject immediately rather than
      // queuing a task that will fail at execution time.
      const chromiumReady = await probeChromiumAvailable();
      if (!chromiumReady) {
        return res.status(503).json({
          ok: false,
          error: "browser_unavailable",
          message: "Браузер (Chromium) недоступен — запустите `npx playwright install chromium` для установки браузера.",
        });
      }

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
          apiKey: settings.apiKey || "",
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

  /** POST /api/kwork/parse-brief — extract fields from raw pasted brief text */
  app.post("/api/kwork/parse-brief", (req, res) => {
    try {
      const { text } = req.body as { text: string };
      if (!text) return res.status(400).json({ error: "text is required" });

      // Heuristic extraction from pasted Kwork brief / email text
      const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

      // Title: first non-empty line that looks like a project title
      const title = lines.find(l => l.length > 10 && l.length < 200 && !l.match(/^\d+/)) || "";

      // Budget: look for number patterns with ₽/руб/rub
      const budgetMatch = text.match(/(\d[\d\s]{2,})\s*(?:₽|руб|rub|тыс\.?\s*₽)/i);
      let budget = 0;
      let budgetRaw = "";
      if (budgetMatch) {
        budget = parseInt(budgetMatch[1].replace(/\s/g, "")) || 0;
        budgetRaw = budgetMatch[0].trim();
        // If value looks like thousands (e.g. "75 тыс ₽")
        if (text.match(/тыс/i) && budget < 1000) budget *= 1000;
      }

      // Category: look for known category keywords
      const catMap: Record<string, string> = {
        telegram: "Telegram боты", bot: "Telegram боты", бот: "Telegram боты",
        gpt: "AI / Чат-боты", llm: "AI / LLM", "ai": "AI / Автоматизация",
        автоматизац: "Интеграции / автоматизация", n8n: "Интеграции / автоматизация",
        парсинг: "Парсинг / автоматизация", playwright: "Парсинг / автоматизация",
        crm: "CRM / интеграции", react: "Web разработка", сайт: "Web разработка",
        mobile: "Мобильные приложения", ios: "Мобильные приложения", android: "Мобильные приложения",
      };
      const textLower = text.toLowerCase();
      let category = "";
      for (const [kw, cat] of Object.entries(catMap)) {
        if (textLower.includes(kw)) { category = cat; break; }
      }

      // URL: look for kwork.ru/projects links
      const urlMatch = text.match(/https?:\/\/kwork\.ru\/[^\s]+/i);
      const orderUrl = urlMatch ? urlMatch[0] : "";

      // Auto-flags
      const flagFitsProfile = /ai|gpt|llm|telegram|автоматизац|парсинг|playwright|интеграц|api|webhook|n8n/i.test(text);
      const flagNeedsCall = /созвон|звонок|по телефону|встреч|обсуд/i.test(text);
      const flagNeedsAccess = /доступ|аккаунт|логин|credentials/i.test(text);
      const flagNeedsDesign = /дизайн|figma|макет|ui\/ux|ui ux/i.test(text);
      const flagNeedsMobile = /мобильн|ios|android|flutter|react native|kotlin|swift/i.test(text);
      const flagCloudVmFit = /vps|сервер|cloud|деплой|docker|linux/i.test(text);

      res.json({
        title,
        budget,
        budgetRaw,
        category,
        orderUrl,
        brief: text.slice(0, 2000),
        flagFitsProfile,
        flagNeedsCall,
        flagNeedsAccess,
        flagNeedsDesign,
        flagNeedsMobile,
        flagCloudVmFit,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/kwork/response-draft — generate a response draft for a lead */
  app.post("/api/kwork/response-draft", async (req, res) => {
    try {
      const { leadId } = req.body as { leadId: number };
      const lead = await storage.getKworkLead(leadId);
      if (!lead) return res.status(404).json({ error: "Lead not found" });

      const whyFits = (() => { try { return JSON.parse(lead.whyFits) as string[]; } catch { return []; } })();
      const keyRisks = (() => { try { return JSON.parse(lead.keyRisks) as string[]; } catch { return []; } })();

      // Try to get an LLM-generated draft if provider is available
      const settings = await storage.getSettings();
      let draft = "";
      let source: "model" | "template" = "template";

      if (settings?.model && settings.model.length > 0) {
        try {
          const providerConfig = {
            providerType: settings.providerType,
            baseUrl: settings.baseUrl,
            port: settings.port,
            model: settings.model,
            apiKey: settings.apiKey || "",
            temperature: parseFloat(settings.temperature) || 0.7,
            maxTokens: Math.min(settings.maxTokens, 800),
          };

          const systemPrompt = `Ты — помощник фрилансера на платформе Kwork. Составь краткий, профессиональный отклик на заказ.
Отклик должен быть 3-5 абзацев на русском языке. Не используй шаблонные фразы типа «рад сотрудничеству».
Укажи конкретные технические навыки. Не обещай невозможного. Закончи вопросом по ТЗ.`;

          const userMsg = `Заказ: ${lead.title}
Бюджет: ${lead.budgetRaw || lead.budget + " ₽"}
ТЗ: ${lead.brief || "не указано"}
Почему подходит: ${whyFits.slice(0, 3).join("; ")}
Риски: ${keyRisks.slice(0, 2).join("; ") || "нет"}`;

          const { chat } = await import("./provider-gateway");
          const response = await chat(providerConfig, [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ]);
          draft = response.content;
          source = "model";
        } catch {
          // Fall through to template
        }
      }

      // Template fallback
      if (!draft) {
        const stacks: string[] = [];
        if (/ai|gpt|llm/i.test(lead.brief + lead.title + lead.category)) stacks.push("AI/LLM агенты");
        if (/telegram|бот/i.test(lead.brief + lead.title + lead.category)) stacks.push("Telegram боты");
        if (/playwright|парсинг/i.test(lead.brief + lead.title + lead.category)) stacks.push("browser automation (Playwright)");
        if (/n8n|автоматизац/i.test(lead.brief + lead.title + lead.category)) stacks.push("workflow автоматизация (n8n)");
        if (/api|webhook|интеграц/i.test(lead.brief + lead.title + lead.category)) stacks.push("API интеграции");
        if (/react|vue|next/i.test(lead.brief + lead.title + lead.category)) stacks.push("React/Node.js");
        if (stacks.length === 0) stacks.push("автоматизация и backend разработка");

        draft = `Здравствуйте! Изучил ваш заказ «${lead.title}».

Специализируюсь на ${stacks.join(", ")}. ${lead.brief ? `В вашем проекте вижу конкретную задачу: ${lead.brief.slice(0, 150).trim()}${lead.brief.length > 150 ? "..." : ""}` : ""}

Из опыта: выстраиваю решения поэтапно, с промежуточными результатами и понятным деплоем на VPS/cloud. Стараюсь работать асинхронно — без лишних созвонов.

${whyFits.length > 0 ? `Могу взяться за: ${whyFits.slice(0, 2).join("; ")}.` : ""}
${keyRisks.length > 0 ? `
Дополнительно уточню: ${keyRisks[0]}.` : ""}

Подскажите: есть ли у вас примеры/референсы или готовое ТЗ в виде документа?`;
        source = "template";
      }

      res.json({ draft, source, leadId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cleanup on server shutdown
  process.on("SIGTERM", async () => { await closeBrowser(); });
  process.on("SIGINT", async () => { await closeBrowser(); });

  return httpServer;
}

// ── Server-side code intent detection (mirrors frontend intent-parser) ────────

// ── Generic product-building intents (no explicit 'код'/'python' required) ────
// These must fire BEFORE browser open/search patterns so that
// «напиши игру» routes to code, not browser.
// Safety: only fires when build-verb is followed by a product-type noun.

/** Build-verb prefixes (RU) — mirrors the client-side RU_BUILD_VERB */
const SRV_RU_BUILD_VERB = /(?:напиши|написать|напишите|создай|создать|создайте|сгенерируй|сгенерировать|сделай|сделать|сделайте|разработай|разработать|реализуй|реализовать|напиши мне|сделай мне|создай мне)/i;

/** Build-verb prefixes (EN) */
const SRV_EN_BUILD_VERB = /(?:write|create|generate|make|build|develop|implement|code)/i;

/** Product-type nouns that imply a code artifact (RU) */
const SRV_RU_PRODUCT_NOUN = /(?:игр[уаыею]|игру|игра|игры| игре|игрой|приложени[еюяей]|приложение|приложения|апп|сайт[ауе]?|сайт|веб.?сайт|веб.?приложени[ея]|калькулятор[ауе]?|калькулятор|бот[ауе]?|бот|чат.?бот[ауе]?|парсер[ауе]?|парсер|скрапер[ауе]?|скрипт[ауе]?|скрипт|программ[ауе]?|программу|функци[яюей]|функцию|модуль|утилит[ауе]?|утилита|тест[ауы]?|тесты|апи|api|сервис[ауе]?|сервис|сервер[ауе]?|сервер|клиент[ауе]?|клиент|демо|прототип[ауе]?|прототип|телеграм.?бот[ауе]?|телеграм.?бот|андроид.?приложени[ея]|ios.?приложени[ея]|мобильн[оеыйа]+.?приложени[ея]|crud|todo|менеджер[ауе]?|дашборд[ауе]?|дашборд|визуализаци[яюей]|чекер[ауе]?|мониторинг[ауе]?|конвертер[ауе]?|генератор[ауе]?|скачиватель|загрузчик[ауе]?|компилятор[ауе]?|интерпретатор[ауе]?|библиотек[ауе]?|фреймворк[ауе]?)/i;

/** Product-type nouns that imply a code artifact (EN) */
const SRV_EN_PRODUCT_NOUN = /(?:game|app|application|website|site|web\s*app|calculator|bot|chatbot|parser|scraper|script|program|function|module|utility|util|test|api|service|server|client|demo|prototype|telegram\s*bot|android\s*app|ios\s*app|mobile\s*app|crud|todo|manager|dashboard|visuali[sz]ation|checker|monitor|converter|generator|downloader|compiler|interpreter|library|framework|cli|tool)/i;

/** Patterns that signal a code-writing / code-running request */
const SERVER_CODE_WRITE_PATTERNS = [
  // ── Generic build-verb + product-noun combos (RU) ──
  new RegExp(`${SRV_RU_BUILD_VERB.source}\\s+(?:\\S+\\s+){0,8}${SRV_RU_PRODUCT_NOUN.source}`, "i"),
  // ── Generic build-verb + product-noun combos (EN) ──
  new RegExp(`${SRV_EN_BUILD_VERB.source}\\s+(?:(?:a|an|the|me|my|simple|small|basic|cool)\\s+)*${SRV_EN_PRODUCT_NOUN.source}`, "i"),

  /(?:напиши|написать|создай|создать|сгенерируй|сгенерировать|сделай|сделать)\s+(?:\S+\s+)*(?:код|скрипт|программ[уа]|функци[юя]|класс|алгоритм|модуль|утилит[уа])/i,
  /(?:write|create|generate|make|build)\s+(?:\S+\s+)*(?:code|script|function|program|class|module|algorithm)/i,
  /(?:запусти|запустить|выполни|выполнить|прогони|прогнать|run|execute|exec)\s+(?:\S+\s+)*(?:код|скрипт|программ[уа]|code|script)/i,
  /(?:напиши|написать|создай|write|create|generate)\s+(?:на\s+)?(?:python|питон|javascript|js|typescript|ts|bash|node|nodejs)/i,
  /(?:python|питон|javascript|js|typescript|ts|bash|node\.?js)\s+(?:код|скрипт|программ[уа]|code|script|program)/i,
  /(?:напиши|write)\s+.{0,60}(?:и\s+)?(?:запусти|run|выполни|execute)/i,
  // «напиши python код hello world» / «напиши python hello world»
  /(?:напиши|написать|создай|сделай|write|create|generate|make)\s+(?:python|питон|javascript|js|typescript|bash|node)\s+/i,
  // Pure language invocations: "python hello world"
  /^(?:python|питон|javascript|js|bash)\s+/i,
];

const SERVER_CODE_RUN_ONLY_PATTERNS = [
  /(?:запусти|запустить|выполни|выполнить|прогони|run|execute|exec)\s+[\w./\\]+\.(?:py|js|ts|sh|bash)/i,
  /(?:запусти|run|execute)\s+(?:этот\s+)?(?:код|code|следующий)/i,
];

/** Returns true if the query is a code / programming intent */
function isServerCodeIntent(query: string): boolean {
  for (const pat of SERVER_CODE_WRITE_PATTERNS) {
    if (pat.test(query)) return true;
  }
  for (const pat of SERVER_CODE_RUN_ONLY_PATTERNS) {
    if (pat.test(query)) return true;
  }
  return false;
}

/** Detect programming language from query text */
function detectCodeLanguage(text: string): "python" | "javascript" | "typescript" | "bash" {
  const lower = text.toLowerCase();
  if (/\bpython\b|\bпитон\b|\.py\b/.test(lower)) return "python";
  if (/\btypescript\b|\bts\b|\.ts\b/.test(lower)) return "typescript";
  if (/\bjavascript\b|\bjs\b|\.js\b|\bnode\.?js\b/.test(lower)) return "javascript";
  if (/\bbash\b|\bshell\b|\.sh\b/.test(lower)) return "bash";
  // Default to Python for generic code requests
  return "python";
}

/**
 * Returns true when the query maps to one of the named template patterns in
 * generateCodeTemplate() — i.e. we can produce a high-quality result instantly
 * without calling an LLM.  This is the fast-path gate.
 *
 * Rules mirror the if-branches inside generateCodeTemplate() for python / JS / bash.
 */
function isTemplateOnlyRequest(lower: string): boolean {
  // Patterns that generateCodeTemplate covers explicitly (RU + EN)
  const EXPLICIT_TEMPLATES = [
    /hello.?world|привет.?мир/,
    /fibonacci|фибоначчи/,
    /factorial|факториал/,
    /\bsort\b|сортировк|сортиров/,
    /\bслов\b|word.?count|подсчёт.?слов|count.?word/,
    /\bprime\b|простых|простые|простое/,
    /\breverse\b|разворот|реверс|обратн/,
    /\bdict\b|словарь|dictionary/,
    /\bfile\b|файл|read.*write|записать|прочитать/,
    /\blist\b|список|\barray\b|массив|\bfilter\b|\bmap\b|\breduce\b/,
    /\bclass\b|класс|\boop\b|объект/,
    // JS-specific
    /\bfetch\b|\brequest\b|\bhttp\b/,
    // Bash
    /\bls\b|\bdir\b|список.*файл|файл.*список/,
    /\bprocess\b|процесс|\bpid\b|\btop\b/,
  ];
  return EXPLICIT_TEMPLATES.some((pat) => pat.test(lower));
}

/**
 * Generate a runnable starter code template from a natural language query.
 * Covers common algorithm, data, utility and file I/O requests in RU + EN.
 * Falls back to a meaningful skeleton (not a dummy result=42) for generic requests.
 */
function generateCodeTemplate(query: string, lower: string, lang: "python" | "javascript" | "typescript" | "bash" | "html" | "css"): string {
  // HTML template
  if (lang === "html") {
    const isGame = /игр[уаыею]|игру|игра|игры|game/i.test(lower);
    const isSite = /сайт|лендинг|website|landing|page/i.test(lower);
    const isCalc = /калькулятор|calculator/i.test(lower);
    if (isCalc) {
      return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Калькулятор</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #1a1a2e; font-family: sans-serif; }
  .calc { background: #16213e; border-radius: 20px; padding: 20px; width: 280px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
  .display { background: #0f3460; color: #e2e8f0; font-size: 2rem; text-align: right; padding: 16px; border-radius: 12px; margin-bottom: 16px; min-height: 70px; word-break: break-all; }
  .buttons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  button { background: #1a1a2e; color: #e2e8f0; border: none; border-radius: 10px; padding: 18px 0; font-size: 1.1rem; cursor: pointer; transition: background 0.15s; }
  button:hover { background: #0f3460; }
  .btn-op { background: #e94560; color: #fff; }
  .btn-eq { background: #4ade80; color: #000; grid-column: span 2; }
  .btn-clear { background: #f59e0b; color: #000; }
</style>
</head>
<body>
<div class="calc">
  <div class="display" id="disp">0</div>
  <div class="buttons">
    <button class="btn-clear" onclick="clear()">AC</button>
    <button class="btn-op" onclick="input('(')">( </button>
    <button class="btn-op" onclick="input(')')"> )</button>
    <button class="btn-op" onclick="input('/')">÷</button>
    <button onclick="input('7')">7</button><button onclick="input('8')">8</button><button onclick="input('9')">9</button>
    <button class="btn-op" onclick="input('*')">×</button>
    <button onclick="input('4')">4</button><button onclick="input('5')">5</button><button onclick="input('6')">6</button>
    <button class="btn-op" onclick="input('-')">−</button>
    <button onclick="input('1')">1</button><button onclick="input('2')">2</button><button onclick="input('3')">3</button>
    <button class="btn-op" onclick="input('+')">\ +</button>
    <button onclick="input('0')">0</button><button onclick="input('.')">.</button>
    <button class="btn-eq" onclick="calc()">＝</button>
  </div>
</div>
<script>
  let expr = "";
  const disp = document.getElementById("disp");
  function input(v) { expr += v; disp.textContent = expr || "0"; }
  function clear() { expr = ""; disp.textContent = "0"; }
  function calc() { try { expr = String(eval(expr)); } catch { expr = "Err"; } disp.textContent = expr; }
<\/script>
</body>
</html>`;
    }
    // Generic HTML skeleton
    const title = query.slice(0, 60);
    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .container { max-width: 720px; width: 100%; padding: 48px 24px; text-align: center; }
  h1 { font-size: 2.5rem; font-weight: 700; margin-bottom: 16px; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  p { color: #94a3b8; font-size: 1.1rem; line-height: 1.6; }
</style>
</head>
<body>
<div class="container">
  <h1>${title}</h1>
  <p>Создано с помощью Local Comet IDE</p>
</div>
</body>
</html>`;
  }

  // CSS template
  if (lang === "css") {
    return `/* ${query} */

:root {
  --primary: #6366f1;
  --bg: #0f172a;
  --surface: #1e293b;
  --text: #e2e8f0;
  --muted: #64748b;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  line-height: 1.6;
}

.container {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 24px;
}

.card {
  background: var(--surface);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 16px;
}`;
  }

  if (lang === "python") {
    if (/hello.?world|привет.?мир/i.test(lower)) {
      return 'print("Hello, World!")';
    }
    if (/fibonacci|фибоначчи/i.test(lower)) {
      return `def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        print(a, end=" ")
        a, b = b, a + b
    print()

fibonacci(10)`;
    }
    if (/factorial|факториал/i.test(lower)) {
      return `def factorial(n):
    return 1 if n <= 1 else n * factorial(n - 1)

for i in range(1, 11):
    print(f"{i}! = {factorial(i)}")`;
    }
    if (/sort|сортировк|sorted|сортиров/i.test(lower)) {
      return `data = [5, 2, 8, 1, 9, 3, 7, 4, 6]
print("Исходный список:", data)
data_sorted = sorted(data)
print("После сортировки:", data_sorted)
# reverse
print("По убыванию:", sorted(data, reverse=True))`;
    }
    if (/\bслов\b|word.?count|подсчёт.?слов|count.?word/i.test(lower)) {
      return `text = "Это пример строки для подсчёта слов в тексте"
words = text.split()
word_count = len(words)
print(f"Текст: '{text}'")
print(f"Количество слов: {word_count}")

# Frequency count
from collections import Counter
freq = Counter(words)
print("\\nЧастота слов:")
for word, count in freq.most_common():
    print(f"  '{word}': {count}")`;
    }
    if (/prime|простых|простые|простое/i.test(lower)) {
      return `def is_prime(n):
    if n < 2: return False
    for i in range(2, int(n**0.5) + 1):
        if n % i == 0: return False
    return True

primes = [n for n in range(2, 50) if is_prime(n)]
print("Простые числа до 50:", primes)
print(f"Всего: {len(primes)}")`;
    }
    if (/reverse|разворот|реверс|обратн/i.test(lower)) {
      return `text = "Hello, World!"
reversed_text = text[::-1]
print(f"Исходная строка: '{text}'")
print(f"Развёрнутая строка: '{reversed_text}'")

numbers = [1, 2, 3, 4, 5]
print(f"Исходный список: {numbers}")
print(f"Развёрнутый список: {numbers[::-1]}")`;
    }
    if (/dict|словарь|dictionary|json/i.test(lower)) {
      return `import json

data = {
    "name": "Local Comet",
    "version": "0.6",
    "features": ["browser", "terminal", "sandbox"],
    "active": True
}

print("Словарь:", data)
print("\\nСериализация в JSON:")
print(json.dumps(data, ensure_ascii=False, indent=2))

# Access
print("\\nName:", data["name"])
print("Features count:", len(data["features"]))`;
    }
    if (/file|файл|read|write|записать|прочитать/i.test(lower)) {
      return `import os

# Запись в файл
filename = "test_output.txt"
with open(filename, "w", encoding="utf-8") as f:
    f.write("Первая строка\\n")
    f.write("Вторая строка\\n")
    f.write("Третья строка\\n")
print(f"Файл '{filename}' записан")

# Чтение из файла
with open(filename, "r", encoding="utf-8") as f:
    content = f.read()
print("Содержимое файла:")
print(content)

# Удаление
os.remove(filename)
print(f"Файл '{filename}' удалён")`;
    }
    if (/list|список|array|массив|filter|map|reduce/i.test(lower)) {
      return `numbers = list(range(1, 11))
print("Список:", numbers)

# map
squares = list(map(lambda x: x**2, numbers))
print("Квадраты:", squares)

# filter
evens = list(filter(lambda x: x % 2 == 0, numbers))
print("Чётные:", evens)

# sum / max / min
print(f"Сумма: {sum(numbers)}, Max: {max(numbers)}, Min: {min(numbers)}")`;
    }
    if (/class|класс|oop|объект/i.test(lower)) {
      return `class Animal:
    def __init__(self, name: str, sound: str):
        self.name = name
        self.sound = sound

    def speak(self):
        return f"{self.name} говорит: {self.sound}!"

    def __repr__(self):
        return f"Animal(name={self.name!r})"

# Создание объектов
dog = Animal("Собака", "Гав")
cat = Animal("Кошка", "Мяу")

print(dog.speak())
print(cat.speak())
print("Объекты:", [dog, cat])`;
    }
    // Generic Python fallback — useful skeleton that actually runs
    return `# Python скрипт: ${query}
import sys

def main():
    print("Запуск скрипта...")
    
    # Демонстрационный пример
    data = [1, 2, 3, 4, 5]
    result = sum(x ** 2 for x in data)
    print(f"Демо: сумма квадратов {data} = {result}")
    
    # TODO: Реализуйте логику для: ${query}
    print("\\nГотово!")

if __name__ == "__main__":
    main()`;
  }

  if (lang === "javascript" || lang === "typescript") {
    if (/hello.?world|привет/i.test(lower)) {
      return 'console.log("Hello, World!");';
    }
    if (/fibonacci|фибоначчи/i.test(lower)) {
      return `function fibonacci(n) {
  let a = 0, b = 1;
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(a);
    [a, b] = [b, a + b];
  }
  return result;
}

console.log("Fibonacci(10):", fibonacci(10).join(" "));`;
    }
    if (/sort|сортировк|сортиров/i.test(lower)) {
      return `const data = [5, 2, 8, 1, 9, 3, 7, 4, 6];
console.log("Original:", data);
const sorted = [...data].sort((a, b) => a - b);
console.log("Sorted asc:", sorted);
console.log("Sorted desc:", [...data].sort((a, b) => b - a));`;
    }
    if (/prime|простых|простые/i.test(lower)) {
      return `function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i <= Math.sqrt(n); i++) {
    if (n % i === 0) return false;
  }
  return true;
}

const primes = Array.from({length: 50}, (_, i) => i + 2).filter(isPrime);
console.log("Primes up to 50:", primes.join(", "));
console.log("Count:", primes.length);`;
    }
    if (/fetch|request|http|api/i.test(lower)) {
      return `// HTTP fetch example (Node.js 18+ built-in fetch)
async function fetchData(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Fetch error:", err.message);
    return null;
  }
}

// Demo with a public API
fetchData("https://httpbin.org/json")
  .then(data => console.log("Response:", JSON.stringify(data, null, 2)))
  .catch(err => console.error(err));`;
    }
    // Generic JS fallback
    return `// Script: ${query}

function main() {
  console.log("Script started");

  // Demo: array processing
  const data = [1, 2, 3, 4, 5];
  const result = data.reduce((acc, x) => acc + x * x, 0);
  console.log(\`Sum of squares of [\${data}] = \${result}\`);

  // TODO: implement logic for: ${query}
  console.log("Done!");
}

main();`;
  }

  if (lang === "bash") {
    if (/hello.?world|привет/i.test(lower)) {
      return 'echo "Hello, World!"';
    }
    if (/list|файл|ls|dir/i.test(lower)) {
      return `#!/bin/bash
echo "=== Текущая директория ==="
pwd
echo ""
echo "=== Содержимое ==="
ls -la
echo ""
echo "=== Использование диска ==="
df -h . 2>/dev/null || echo "(df недоступен)"`;
    }
    if (/process|процесс|pid|top/i.test(lower)) {
      return `#!/bin/bash
echo "=== Запущенные процессы (top 10 по CPU) ==="
ps aux --sort=-%cpu 2>/dev/null | head -11 || ps aux | head -11
echo ""
echo "=== Память ==="
free -h 2>/dev/null || echo "(free недоступен)"`;
    }
    // Generic bash fallback
    return `#!/bin/bash
# Script: ${query}
set -e

echo "=== Скрипт запущен ==="
echo "Дата: $(date)"
echo "Директория: $(pwd)"
echo ""

# TODO: реализуйте логику для: ${query}
echo ""
echo "=== Готово ==="`;
  }

  // Should never reach here, but safety fallback
  return `print("Script: ${query}")`;
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

  // 0) Code intent guard — should never reach here due to /api/computer/run early return,
  //    but included as belt-and-suspenders to prevent google fallback for code queries.
  if (isServerCodeIntent(raw)) {
    return { url: "", goal: raw };
  }

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

  // 2) Compound open+search patterns:
  //    "открой google и найди X", "open youtube and find X", "зайди на гитхаб и найди X"
  const compoundPatterns = [
    /^(?:открой|открыть|зайди на|перейди на|go to|open|launch)\s+(\S+)\s+(?:и|and|&)\s+(?:найди|поиск|find|search)\s+(.+)$/i,
    /^(?:открой|открыть|зайди на|перейди на|go to|open|launch)\s+(\S+)\s+(?:,\s*)?(?:найди|поищи|find|search)\s+(.+)$/i,
  ];
  for (const pat of compoundPatterns) {
    const m = raw.match(pat);
    if (m) {
      const siteName = m[1].trim().toLowerCase();
      const searchTerm = m[2].trim();
      if (KNOWN_SITES[siteName] && searchTerm) {
        // Navigate to the site but set goal to include search so agent continues
        return { url: KNOWN_SITES[siteName], goal: `Найти: ${searchTerm}` };
      }
      // Also try search engine template directly
      if (SEARCH_ENGINES[siteName] && searchTerm) {
        const url = SEARCH_ENGINES[siteName].replace("{q}", encodeURIComponent(searchTerm));
        return { url, goal: `Найти: ${searchTerm}` };
      }
    }
  }

  // 3) Open patterns: "открой google", "open github"
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

  // 4) Bare known site
  if (KNOWN_SITES[lower]) {
    return { url: KNOWN_SITES[lower], goal: `Открыть ${lower} и изучить страницу` };
  }

  // 5) Bare URL
  if (URL_RE.test(raw)) {
    const u = raw.startsWith("http") ? raw : `https://${raw}`;
    return { url: u, goal: `Изучить страницу ${u}` };
  }

  // 6) Anything with a recognizable site name + action (e.g. "посмотри что нового на habr")
  for (const [name, url] of Object.entries(KNOWN_SITES)) {
    if (lower.includes(name)) {
      return { url, goal: raw };
    }
  }

  // 7) Fallback: treat as general goal on Google search
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
  return { url: searchUrl, goal: raw };
}

function detectQueryType(query: string): string {
  // Code intent must be checked first — before URL or search patterns
  if (isServerCodeIntent(query)) return "code_task";
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