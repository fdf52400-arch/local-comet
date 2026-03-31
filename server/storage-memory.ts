/**
 * MemoryStorage — in-memory fallback for environments where better-sqlite3
 * native binaries are unavailable (e.g. Windows with Linux-built .node files,
 * or any platform missing build tools).
 *
 * Data is NOT persisted across restarts. All functionality works — tasks,
 * logs, settings, workspaces, tabs, leads — but the data lives only in RAM.
 *
 * This implementation mirrors the IStorage interface exactly.
 */

import type {
  ProviderSettings, InsertProviderSettings,
  AgentTask, InsertAgentTask,
  AgentLog, InsertAgentLog,
  StepSnapshot, InsertStepSnapshot,
  Workspace, InsertWorkspace,
  SessionTab, InsertSessionTab,
  KworkLead,
} from "@shared/schema";
import type { IStorage } from "./storage";

export class MemoryStorage implements IStorage {
  private _settings: ProviderSettings | undefined = undefined;
  private _workspaces: Workspace[] = [];
  private _tabs: SessionTab[] = [];
  private _tasks: AgentTask[] = [];
  private _logs: AgentLog[] = [];
  private _snapshots: StepSnapshot[] = [];
  private _leads: KworkLead[] = [];

  private _wId = 1;
  private _tabId = 1;
  private _taskId = 1;
  private _logId = 1;
  private _snapId = 1;
  private _leadId = 1;
  private _settingsId = 1;

  constructor() {
    // Seed a default workspace
    this._workspaces.push({
      id: this._wId++,
      name: "Default",
      description: "Рабочее пространство по умолчанию",
      isActive: 1,
      createdAt: new Date().toISOString(),
    });
  }

  // ── Provider settings ────────────────────────────────────────────────────

  async getSettings(): Promise<ProviderSettings | undefined> {
    return this._settings;
  }

  async upsertSettings(settings: InsertProviderSettings): Promise<ProviderSettings> {
    if (this._settings) {
      this._settings = { ...this._settings, ...settings };
    } else {
      this._settings = { id: this._settingsId++, ...settings } as ProviderSettings;
    }
    return this._settings;
  }

  // ── Workspaces ───────────────────────────────────────────────────────────

  async getWorkspaces(): Promise<Workspace[]> {
    return [...this._workspaces].sort((a, b) => a.id - b.id);
  }

  async getWorkspace(id: number): Promise<Workspace | undefined> {
    return this._workspaces.find(w => w.id === id);
  }

  async getActiveWorkspace(): Promise<Workspace | undefined> {
    return this._workspaces.find(w => w.isActive === 1);
  }

  async createWorkspace(ws: InsertWorkspace): Promise<Workspace> {
    const row: Workspace = {
      id: this._wId++,
      name: ws.name,
      description: ws.description ?? "",
      isActive: ws.isActive ?? 0,
      createdAt: new Date().toISOString(),
    };
    this._workspaces.push(row);
    return row;
  }

  async setActiveWorkspace(id: number): Promise<Workspace | undefined> {
    this._workspaces.forEach(w => { w.isActive = 0; });
    const target = this._workspaces.find(w => w.id === id);
    if (target) target.isActive = 1;
    return target;
  }

  // ── Session Tabs ─────────────────────────────────────────────────────────

  async getTabsBySession(workspaceId: number, sessionId: string): Promise<SessionTab[]> {
    return this._tabs
      .filter(t => t.workspaceId === workspaceId && t.sessionId === sessionId)
      .sort((a, b) => a.id - b.id);
  }

  async getTab(id: number): Promise<SessionTab | undefined> {
    return this._tabs.find(t => t.id === id);
  }

  async createTab(tab: InsertSessionTab): Promise<SessionTab> {
    const row: SessionTab = {
      id: this._tabId++,
      workspaceId: tab.workspaceId ?? 1,
      sessionId: tab.sessionId ?? "default",
      label: tab.label ?? "Tab",
      url: tab.url ?? "",
      isActive: tab.isActive ?? 0,
      previewState: tab.previewState ?? "{}",
      snapshotJson: tab.snapshotJson ?? null,
      selectedElement: tab.selectedElement ?? null,
      historyJson: tab.historyJson ?? "[]",
      createdAt: new Date().toISOString(),
    };
    this._tabs.push(row);
    return row;
  }

  async updateTab(id: number, updates: Partial<InsertSessionTab>): Promise<SessionTab | undefined> {
    const row = this._tabs.find(t => t.id === id);
    if (!row) return undefined;
    Object.assign(row, updates);
    return row;
  }

  async setActiveTab(workspaceId: number, sessionId: string, tabId: number): Promise<void> {
    this._tabs
      .filter(t => t.workspaceId === workspaceId && t.sessionId === sessionId)
      .forEach(t => { t.isActive = 0; });
    const target = this._tabs.find(t => t.id === tabId);
    if (target) target.isActive = 1;
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  async getTasks(): Promise<AgentTask[]> {
    return [...this._tasks].sort((a, b) => b.id - a.id);
  }

  async getTasksBySession(sessionId: string): Promise<AgentTask[]> {
    return this._tasks.filter(t => t.sessionId === sessionId).sort((a, b) => b.id - a.id);
  }

  async getTasksByWorkspace(workspaceId: number): Promise<AgentTask[]> {
    return this._tasks.filter(t => t.workspaceId === workspaceId).sort((a, b) => b.id - a.id);
  }

  async getTask(id: number): Promise<AgentTask | undefined> {
    return this._tasks.find(t => t.id === id);
  }

  async createTask(task: InsertAgentTask): Promise<AgentTask> {
    const maxPos = this._tasks.reduce((max, t) => Math.max(max, t.queuePosition || 0), 0);
    const row: AgentTask = {
      id: this._taskId++,
      workspaceId: task.workspaceId ?? 1,
      sessionId: task.sessionId ?? "default",
      title: task.title,
      targetUrl: task.targetUrl,
      goal: task.goal,
      status: "queued",
      plan: "[]",
      queuePosition: maxPos + 1,
      createdAt: new Date().toISOString(),
    };
    this._tasks.push(row);
    return row;
  }

  async updateTaskStatus(id: number, status: string, plan?: string): Promise<AgentTask | undefined> {
    const row = this._tasks.find(t => t.id === id);
    if (!row) return undefined;
    row.status = status;
    if (plan !== undefined) row.plan = plan;
    return row;
  }

  async getQueuedTasks(): Promise<AgentTask[]> {
    return this._tasks.filter(t => t.status === "queued").sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));
  }

  async getRunningTask(): Promise<AgentTask | undefined> {
    return this._tasks.find(t => t.status === "running");
  }

  async getNextQueuedTask(): Promise<AgentTask | undefined> {
    const queued = await this.getQueuedTasks();
    return queued[0];
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  async getSessions(): Promise<{ sessionId: string; taskCount: number; lastActivity: string }[]> {
    const sessMap = new Map<string, { count: number; last: string }>();
    for (const t of this._tasks) {
      const sid = t.sessionId || "default";
      const ex = sessMap.get(sid);
      if (ex) {
        ex.count++;
        if (t.createdAt > ex.last) ex.last = t.createdAt;
      } else {
        sessMap.set(sid, { count: 1, last: t.createdAt });
      }
    }
    if (!sessMap.has("default")) {
      sessMap.set("default", { count: 0, last: new Date().toISOString() });
    }
    return Array.from(sessMap.entries()).map(([sessionId, d]) => ({
      sessionId, taskCount: d.count, lastActivity: d.last,
    }));
  }

  async getSessionsByWorkspace(workspaceId: number): Promise<{ sessionId: string; taskCount: number; lastActivity: string }[]> {
    const tasks = this._tasks.filter(t => t.workspaceId === workspaceId);
    const sessMap = new Map<string, { count: number; last: string }>();
    for (const t of tasks) {
      const sid = t.sessionId || "default";
      const ex = sessMap.get(sid);
      if (ex) {
        ex.count++;
        if (t.createdAt > ex.last) ex.last = t.createdAt;
      } else {
        sessMap.set(sid, { count: 1, last: t.createdAt });
      }
    }
    if (!sessMap.has("default")) {
      sessMap.set("default", { count: 0, last: new Date().toISOString() });
    }
    return Array.from(sessMap.entries()).map(([sessionId, d]) => ({
      sessionId, taskCount: d.count, lastActivity: d.last,
    }));
  }

  // ── Logs ─────────────────────────────────────────────────────────────────

  async getLogsForTask(taskId: number): Promise<AgentLog[]> {
    return this._logs.filter(l => l.taskId === taskId);
  }

  async getLogsForSession(sessionId: string): Promise<AgentLog[]> {
    return this._logs.filter(l => l.sessionId === sessionId).sort((a, b) => b.id - a.id);
  }

  async addLog(log: InsertAgentLog): Promise<AgentLog> {
    const row: AgentLog = {
      id: this._logId++,
      workspaceId: log.workspaceId ?? 1,
      sessionId: log.sessionId ?? "default",
      stepIndex: log.stepIndex ?? 0,
      detail: log.detail ?? "",
      status: log.status ?? "info",
      taskId: log.taskId,
      action: log.action,
      timestamp: log.timestamp,
    };
    this._logs.push(row);
    return row;
  }

  // ── Step snapshots ───────────────────────────────────────────────────────

  async getStepSnapshots(taskId: number): Promise<StepSnapshot[]> {
    return this._snapshots.filter(s => s.taskId === taskId).sort((a, b) => a.stepIndex - b.stepIndex);
  }

  async addStepSnapshot(snapshot: InsertStepSnapshot): Promise<StepSnapshot> {
    const row: StepSnapshot = {
      id: this._snapId++,
      workspaceId: snapshot.workspaceId ?? 1,
      sessionId: snapshot.sessionId ?? "default",
      phase: snapshot.phase ?? "",
      action: snapshot.action ?? "",
      status: snapshot.status ?? "info",
      detail: snapshot.detail ?? "",
      screenshotBase64: snapshot.screenshotBase64 ?? null,
      snapshotJson: snapshot.snapshotJson ?? null,
      taskId: snapshot.taskId,
      stepIndex: snapshot.stepIndex,
      timestamp: snapshot.timestamp,
    };
    this._snapshots.push(row);
    return row;
  }

  // ── Export ───────────────────────────────────────────────────────────────

  async exportSession(workspaceId: number, sessionId: string): Promise<any> {
    const tasks = this._tasks
      .filter(t => t.workspaceId === workspaceId && t.sessionId === sessionId)
      .sort((a, b) => b.id - a.id);
    const logs = this._logs
      .filter(l => l.sessionId === sessionId)
      .sort((a, b) => a.id - b.id);
    const tabs = this._tabs
      .filter(t => t.workspaceId === workspaceId && t.sessionId === sessionId)
      .sort((a, b) => a.id - b.id);
    const ws = await this.getWorkspace(workspaceId);

    return {
      exportedAt: new Date().toISOString(),
      workspace: ws ? { id: ws.id, name: ws.name } : null,
      sessionId,
      tasks: tasks.map(t => ({ id: t.id, title: t.title, targetUrl: t.targetUrl, goal: t.goal, status: t.status, plan: t.plan, createdAt: t.createdAt })),
      logs: logs.map(l => ({ id: l.id, taskId: l.taskId, stepIndex: l.stepIndex, action: l.action, detail: l.detail, status: l.status, timestamp: l.timestamp })),
      tabs: tabs.map(t => ({ id: t.id, label: t.label, url: t.url, isActive: t.isActive })),
      summary: {
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.status === "completed").length,
        errorTasks: tasks.filter(t => t.status === "error").length,
        totalLogs: logs.length,
        totalTabs: tabs.length,
      },
    };
  }

  async exportTask(taskId: number): Promise<any> {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return null;
    const logs = this._logs.filter(l => l.taskId === taskId).sort((a, b) => a.id - b.id);
    const steps = this._snapshots.filter(s => s.taskId === taskId).sort((a, b) => a.stepIndex - b.stepIndex);

    return {
      exportedAt: new Date().toISOString(),
      task: { id: task.id, workspaceId: task.workspaceId, sessionId: task.sessionId, title: task.title, targetUrl: task.targetUrl, goal: task.goal, status: task.status, plan: task.plan, createdAt: task.createdAt },
      logs: logs.map(l => ({ id: l.id, stepIndex: l.stepIndex, action: l.action, detail: l.detail, status: l.status, timestamp: l.timestamp })),
      steps: steps.map(s => ({ stepIndex: s.stepIndex, phase: s.phase, action: s.action, status: s.status, detail: s.detail, timestamp: s.timestamp, hasScreenshot: !!s.screenshotBase64, snapshotJson: s.snapshotJson })),
      summary: { totalSteps: steps.length, totalLogs: logs.length, hasErrors: logs.some(l => l.status === "error") },
    };
  }

  // ── Kwork Leads ──────────────────────────────────────────────────────────

  async getKworkLeads(): Promise<KworkLead[]> {
    return [...this._leads].sort((a, b) => b.id - a.id);
  }

  async getKworkLead(id: number): Promise<KworkLead | undefined> {
    return this._leads.find(l => l.id === id);
  }

  async createKworkLead(lead: Omit<KworkLead, "id" | "createdAt"> & { fitScore: number; recommendation: string; whyFits: string; keyRisks: string }): Promise<KworkLead> {
    const row: KworkLead = {
      id: this._leadId++,
      ...lead,
      createdAt: new Date().toISOString(),
    };
    this._leads.push(row);
    return row;
  }

  async updateKworkLead(id: number, updates: Partial<KworkLead>): Promise<KworkLead | undefined> {
    const row = this._leads.find(l => l.id === id);
    if (!row) return undefined;
    Object.assign(row, updates);
    return row;
  }

  async deleteKworkLead(id: number): Promise<void> {
    this._leads = this._leads.filter(l => l.id !== id);
  }

  async seedKworkLeads(): Promise<void> {
    if (this._leads.length > 0) return;
    const now = new Date().toISOString();
    const seeds: Array<Omit<KworkLead, "id" | "createdAt">> = [
      {
        source: "email",
        sourceRaw: "Kwork email digest — March 2026",
        title: "Разработка AI-агента для автоматизации работы с CRM",
        budget: 120000,
        budgetRaw: "120 000 ₽",
        orderUrl: null,
        brief: "Нужен AI-агент, который будет автоматически обрабатывать входящие заявки в AmoCRM, классифицировать их по приоритету, генерировать ответы с помощью GPT и создавать задачи для менеджеров. Интеграция через webhook + REST API.",
        category: "AI / Автоматизация",
        flagFitsProfile: 1, flagNeedsCall: 0, flagNeedsAccess: 1, flagNeedsDesign: 0, flagNeedsMobile: 0, flagCloudVmFit: 1,
        fitScore: 88, recommendation: "strong_fit",
        whyFits: JSON.stringify(["Бюджет 120 000 ₽ — проходит базовый фильтр", "AI/LLM fit: ai, gpt, openai", "Automation fit", "Integration fit: api, webhook, crm"]),
        keyRisks: JSON.stringify(["Нужны доступы к аккаунтам заказчика"]),
        status: "new", isShortlisted: 0, computerTaskId: null,
        receivedAt: "2026-03-28T09:15:00.000Z",
      },
      {
        source: "email",
        sourceRaw: "Kwork email digest — March 2026",
        title: "Telegram-бот для онлайн-школы: запись, оплата, уведомления",
        budget: 75000, budgetRaw: "75 000 ₽", orderUrl: null,
        brief: "Бот для онлайн-школы английского языка. Запись, оплата ЮKassa, напоминания, admin-панель.",
        category: "Telegram боты",
        flagFitsProfile: 1, flagNeedsCall: 0, flagNeedsAccess: 0, flagNeedsDesign: 0, flagNeedsMobile: 0, flagCloudVmFit: 1,
        fitScore: 77, recommendation: "strong_fit",
        whyFits: JSON.stringify(["Бюджет 75 000 ₽", "Telegram bot fit"]),
        keyRisks: JSON.stringify([]),
        status: "new", isShortlisted: 1, computerTaskId: null,
        receivedAt: "2026-03-27T14:30:00.000Z",
      },
      {
        source: "manual", sourceRaw: "",
        title: "Парсер и мониторинг цен на маркетплейсах (Ozon, Wildberries)",
        budget: 55000, budgetRaw: "55 000 ₽", orderUrl: "https://kwork.ru/projects/12345",
        brief: "Скрипт мониторинга цен конкурентов. Выгрузка в Google Sheets раз в 4 часа. Playwright/Selenium. VPS.",
        category: "Парсинг / автоматизация",
        flagFitsProfile: 1, flagNeedsCall: 0, flagNeedsAccess: 0, flagNeedsDesign: 0, flagNeedsMobile: 0, flagCloudVmFit: 1,
        fitScore: 73, recommendation: "strong_fit",
        whyFits: JSON.stringify(["Browser automation fit: playwright", "Cloud/infra fit: vps"]),
        keyRisks: JSON.stringify([]),
        status: "opened", isShortlisted: 1, computerTaskId: null,
        receivedAt: "2026-03-26T11:00:00.000Z",
      },
      {
        source: "email", sourceRaw: "Kwork email digest — March 2026",
        title: "Разработка чат-бота с GPT-4o и базой знаний",
        budget: 90000, budgetRaw: "90 000 ₽", orderUrl: "https://kwork.ru/projects/67890",
        brief: "Умный бот для Telegram и WhatsApp. GPT-4o + база знаний. Переключение на оператора. Аналитика.",
        category: "AI / Чат-боты",
        flagFitsProfile: 1, flagNeedsCall: 0, flagNeedsAccess: 0, flagNeedsDesign: 0, flagNeedsMobile: 0, flagCloudVmFit: 1,
        fitScore: 84, recommendation: "strong_fit",
        whyFits: JSON.stringify(["AI/LLM fit: gpt, llm", "Telegram bot fit"]),
        keyRisks: JSON.stringify([]),
        status: "new", isShortlisted: 0, computerTaskId: null,
        receivedAt: "2026-03-30T07:00:00.000Z",
      },
    ];
    for (const seed of seeds) {
      this._leads.push({ id: this._leadId++, ...seed, createdAt: now });
    }
  }
}
