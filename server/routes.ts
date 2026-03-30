import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { checkProvider, listModels, chat, requestPlanFromModel } from "./provider-gateway";
import { runAgentTask, closeBrowser, generateFallbackPlan, type AgentAction } from "./agent-engine";
import type { DemoScenario } from "@shared/schema";

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
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      service: "Local Comet",
    });
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

  // ---- Agent: plan ----
  app.post("/api/agent/plan", async (req, res) => {
    try {
      const { url, goal } = req.body;
      if (!url || !goal) {
        return res.status(400).json({ error: "Требуются url и goal" });
      }

      // Try model-based planning first
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

  // ---- Agent: run ----
  app.post("/api/agent/run", async (req, res) => {
    try {
      const { url, goal, taskId } = req.body;
      if (!url || !goal) {
        return res.status(400).json({ error: "Требуются url и goal" });
      }

      // Get safety mode from settings
      const settings = await storage.getSettings();
      const safetyMode = settings?.safetyMode || "readonly";

      // Create or get task
      let task;
      if (taskId) {
        task = await storage.getTask(taskId);
      }
      if (!task) {
        task = await storage.createTask({ title: goal.slice(0, 100), targetUrl: url, goal });
      }
      await storage.updateTaskStatus(task.id, "planning");
      await storage.addLog({
        taskId: task.id,
        stepIndex: 0,
        action: "init",
        detail: `Начало задачи: ${goal}`,
        status: "info",
        timestamp: new Date().toISOString(),
      });

      // Try model plan first
      let modelPlan: AgentAction[] | null = null;
      let planSource = "fallback";

      if (settings?.model) {
        try {
          const raw = await requestPlanFromModel(
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
          if (raw && Array.isArray(raw)) {
            modelPlan = raw as AgentAction[];
            planSource = "model";
          }
        } catch {
          // fallback
        }
      }

      await storage.updateTaskStatus(task.id, "running", JSON.stringify(modelPlan || generateFallbackPlan(goal, url)));

      await storage.addLog({
        taskId: task.id,
        stepIndex: 0,
        action: "plan",
        detail: planSource === "model"
          ? "План сгенерирован моделью"
          : "План сгенерирован эвристически (модель недоступна)",
        status: "info",
        timestamp: new Date().toISOString(),
      });

      // Execute
      const { plan, results } = await runAgentTask(url, goal, safetyMode, modelPlan);

      // Log each step
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        await storage.addLog({
          taskId: task.id,
          stepIndex: i + 1,
          action: r.action,
          detail: r.detail,
          status: r.status === "blocked" ? "warning" : r.status,
          timestamp: new Date().toISOString(),
        });
      }

      const hasErrors = results.some(r => r.status === "error");
      const finalStatus = hasErrors ? "error" : "completed";
      await storage.updateTaskStatus(task.id, finalStatus, JSON.stringify(plan));

      await storage.addLog({
        taskId: task.id,
        stepIndex: results.length + 1,
        action: "finish",
        detail: hasErrors ? "Задача завершена с ошибками" : "Задача выполнена успешно",
        status: hasErrors ? "error" : "success",
        timestamp: new Date().toISOString(),
      });

      res.json({
        task: await storage.getTask(task.id),
        plan,
        results,
        planSource,
        logs: await storage.getLogsForTask(task.id),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Tasks history ----
  app.get("/api/tasks", async (_req, res) => {
    try {
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

  // Cleanup on server shutdown
  process.on("SIGTERM", async () => { await closeBrowser(); });
  process.on("SIGINT", async () => { await closeBrowser(); });

  return httpServer;
}
