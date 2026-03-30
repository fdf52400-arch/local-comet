import {
  type ProviderSettings, type InsertProviderSettings, providerSettings,
  type AgentTask, type InsertAgentTask, agentTasks,
  type AgentLog, type InsertAgentLog, agentLogs,
  type StepSnapshot, type InsertStepSnapshot, stepSnapshots,
  type Workspace, type InsertWorkspace, workspaces,
  type SessionTab, type InsertSessionTab, sessionTabs,
  type KworkLead, type InsertKworkLead, kworkLeads,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, asc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// ─── Migrations ───────────────────────────────────────────────────────────────

function migrate() {
  // Ensure core tables exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS provider_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_type TEXT NOT NULL DEFAULT 'ollama',
      base_url TEXT NOT NULL DEFAULT 'http://127.0.0.1',
      port INTEGER NOT NULL DEFAULT 11436,
      model TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      temperature TEXT NOT NULL DEFAULT '0.7',
      max_tokens INTEGER NOT NULL DEFAULT 2048,
      safety_mode TEXT NOT NULL DEFAULT 'readonly'
    )
  `);

  // Add api_key column to provider_settings if missing (migration for existing DBs)
  try {
    sqlite.exec(`ALTER TABLE provider_settings ADD COLUMN api_key TEXT NOT NULL DEFAULT ''`);
  } catch { /* column already exists */ }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      session_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      target_url TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      plan TEXT NOT NULL DEFAULT '[]',
      queue_position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      session_id TEXT NOT NULL DEFAULT 'default',
      step_index INTEGER NOT NULL DEFAULT 0,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'info',
      timestamp TEXT NOT NULL
    )
  `);

  // Add sessionId column to agent_tasks if missing
  try {
    sqlite.exec(`ALTER TABLE agent_tasks ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'`);
  } catch { /* column already exists */ }

  // Add queue_position column to agent_tasks if missing
  try {
    sqlite.exec(`ALTER TABLE agent_tasks ADD COLUMN queue_position INTEGER NOT NULL DEFAULT 0`);
  } catch { /* column already exists */ }

  // Add sessionId column to agent_logs if missing
  try {
    sqlite.exec(`ALTER TABLE agent_logs ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'`);
  } catch { /* column already exists */ }

  // Create step_snapshots table if missing
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS step_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      session_id TEXT NOT NULL DEFAULT 'default',
      step_index INTEGER NOT NULL,
      phase TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'info',
      detail TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL,
      screenshot_base64 TEXT,
      snapshot_json TEXT
    )
  `);

  // Migrate old statuses: pending → queued, planning → queued
  try {
    sqlite.exec(`UPDATE agent_tasks SET status = 'queued' WHERE status = 'pending'`);
    sqlite.exec(`UPDATE agent_tasks SET status = 'running' WHERE status = 'planning'`);
  } catch { /* ignore */ }

  // ── Iteration 6 migrations ──

  // Create workspaces table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  // Create session_tabs table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS session_tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1,
      session_id TEXT NOT NULL DEFAULT 'default',
      label TEXT NOT NULL DEFAULT 'Tab',
      url TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      preview_state TEXT NOT NULL DEFAULT '{}',
      snapshot_json TEXT,
      selected_element TEXT,
      history_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `);

  // Add workspace_id columns
  try {
    sqlite.exec(`ALTER TABLE agent_tasks ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`);
  } catch { /* column already exists */ }

  try {
    sqlite.exec(`ALTER TABLE agent_logs ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`);
  } catch { /* column already exists */ }

  try {
    sqlite.exec(`ALTER TABLE step_snapshots ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`);
  } catch { /* column already exists */ }

  // ── Kwork leads migrations ──

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS kwork_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'manual',
      source_raw TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      budget INTEGER NOT NULL DEFAULT 0,
      budget_raw TEXT NOT NULL DEFAULT '',
      order_url TEXT,
      brief TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      flag_fits_profile INTEGER NOT NULL DEFAULT 0,
      flag_needs_call INTEGER NOT NULL DEFAULT 0,
      flag_needs_access INTEGER NOT NULL DEFAULT 0,
      flag_needs_design INTEGER NOT NULL DEFAULT 0,
      flag_needs_mobile INTEGER NOT NULL DEFAULT 0,
      flag_cloud_vm_fit INTEGER NOT NULL DEFAULT 0,
      fit_score INTEGER NOT NULL DEFAULT 0,
      recommendation TEXT NOT NULL DEFAULT 'review_manually',
      why_fits TEXT NOT NULL DEFAULT '[]',
      key_risks TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'new',
      is_shortlisted INTEGER NOT NULL DEFAULT 0,
      computer_task_id INTEGER,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Ensure default workspace exists
  const wsCount = sqlite.prepare(`SELECT COUNT(*) as cnt FROM workspaces`).get() as any;
  if (wsCount.cnt === 0) {
    sqlite.prepare(`INSERT INTO workspaces (name, description, is_active, created_at) VALUES (?, ?, 1, ?)`).run(
      "Default", "Рабочее пространство по умолчанию", new Date().toISOString()
    );
  }
}

migrate();

// ─── Storage Interface ────────────────────────────────────────────────────────

export interface IStorage {
  // Provider settings
  getSettings(): Promise<ProviderSettings | undefined>;
  upsertSettings(settings: InsertProviderSettings): Promise<ProviderSettings>;

  // Workspaces
  getWorkspaces(): Promise<Workspace[]>;
  getWorkspace(id: number): Promise<Workspace | undefined>;
  getActiveWorkspace(): Promise<Workspace | undefined>;
  createWorkspace(ws: InsertWorkspace): Promise<Workspace>;
  setActiveWorkspace(id: number): Promise<Workspace | undefined>;

  // Session Tabs
  getTabsBySession(workspaceId: number, sessionId: string): Promise<SessionTab[]>;
  getTab(id: number): Promise<SessionTab | undefined>;
  createTab(tab: InsertSessionTab): Promise<SessionTab>;
  updateTab(id: number, updates: Partial<InsertSessionTab>): Promise<SessionTab | undefined>;
  setActiveTab(workspaceId: number, sessionId: string, tabId: number): Promise<void>;

  // Tasks
  getTasks(): Promise<AgentTask[]>;
  getTasksBySession(sessionId: string): Promise<AgentTask[]>;
  getTasksByWorkspace(workspaceId: number): Promise<AgentTask[]>;
  getTask(id: number): Promise<AgentTask | undefined>;
  createTask(task: InsertAgentTask): Promise<AgentTask>;
  updateTaskStatus(id: number, status: string, plan?: string): Promise<AgentTask | undefined>;

  // Queue
  getQueuedTasks(): Promise<AgentTask[]>;
  getRunningTask(): Promise<AgentTask | undefined>;
  getNextQueuedTask(): Promise<AgentTask | undefined>;

  // Sessions
  getSessions(): Promise<{ sessionId: string; taskCount: number; lastActivity: string }[]>;
  getSessionsByWorkspace(workspaceId: number): Promise<{ sessionId: string; taskCount: number; lastActivity: string }[]>;

  // Logs
  getLogsForTask(taskId: number): Promise<AgentLog[]>;
  getLogsForSession(sessionId: string): Promise<AgentLog[]>;
  addLog(log: InsertAgentLog): Promise<AgentLog>;

  // Step snapshots
  getStepSnapshots(taskId: number): Promise<StepSnapshot[]>;
  addStepSnapshot(snapshot: InsertStepSnapshot): Promise<StepSnapshot>;

  // Export
  exportSession(workspaceId: number, sessionId: string): Promise<any>;
  exportTask(taskId: number): Promise<any>;

  // Kwork Leads
  getKworkLeads(): Promise<KworkLead[]>;
  getKworkLead(id: number): Promise<KworkLead | undefined>;
  createKworkLead(lead: Omit<KworkLead, "id" | "createdAt"> & { fitScore: number; recommendation: string; whyFits: string; keyRisks: string }): Promise<KworkLead>;
  updateKworkLead(id: number, updates: Partial<KworkLead>): Promise<KworkLead | undefined>;
  deleteKworkLead(id: number): Promise<void>;
  seedKworkLeads(): Promise<void>;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class DatabaseStorage implements IStorage {
  // ── Provider settings ──

  async getSettings(): Promise<ProviderSettings | undefined> {
    return db.select().from(providerSettings).get();
  }

  async upsertSettings(settings: InsertProviderSettings): Promise<ProviderSettings> {
    const existing = await this.getSettings();
    if (existing) {
      return db.update(providerSettings)
        .set(settings)
        .where(eq(providerSettings.id, existing.id))
        .returning()
        .get();
    }
    return db.insert(providerSettings).values(settings).returning().get();
  }

  // ── Workspaces ──

  async getWorkspaces(): Promise<Workspace[]> {
    return db.select().from(workspaces).orderBy(asc(workspaces.id)).all();
  }

  async getWorkspace(id: number): Promise<Workspace | undefined> {
    return db.select().from(workspaces).where(eq(workspaces.id, id)).get();
  }

  async getActiveWorkspace(): Promise<Workspace | undefined> {
    return db.select().from(workspaces).where(eq(workspaces.isActive, 1)).get();
  }

  async createWorkspace(ws: InsertWorkspace): Promise<Workspace> {
    return db.insert(workspaces).values({
      ...ws,
      createdAt: new Date().toISOString(),
    }).returning().get();
  }

  async setActiveWorkspace(id: number): Promise<Workspace | undefined> {
    // Deactivate all
    db.update(workspaces).set({ isActive: 0 }).run();
    // Activate selected
    return db.update(workspaces)
      .set({ isActive: 1 })
      .where(eq(workspaces.id, id))
      .returning()
      .get();
  }

  // ── Session Tabs ──

  async getTabsBySession(workspaceId: number, sessionId: string): Promise<SessionTab[]> {
    return db.select().from(sessionTabs)
      .where(and(eq(sessionTabs.workspaceId, workspaceId), eq(sessionTabs.sessionId, sessionId)))
      .orderBy(asc(sessionTabs.id))
      .all();
  }

  async getTab(id: number): Promise<SessionTab | undefined> {
    return db.select().from(sessionTabs).where(eq(sessionTabs.id, id)).get();
  }

  async createTab(tab: InsertSessionTab): Promise<SessionTab> {
    return db.insert(sessionTabs).values({
      ...tab,
      createdAt: new Date().toISOString(),
    }).returning().get();
  }

  async updateTab(id: number, updates: Partial<InsertSessionTab>): Promise<SessionTab | undefined> {
    return db.update(sessionTabs)
      .set(updates)
      .where(eq(sessionTabs.id, id))
      .returning()
      .get();
  }

  async setActiveTab(workspaceId: number, sessionId: string, tabId: number): Promise<void> {
    // Deactivate all tabs in session
    const tabs = await this.getTabsBySession(workspaceId, sessionId);
    for (const t of tabs) {
      db.update(sessionTabs).set({ isActive: 0 }).where(eq(sessionTabs.id, t.id)).run();
    }
    // Activate selected
    db.update(sessionTabs).set({ isActive: 1 }).where(eq(sessionTabs.id, tabId)).run();
  }

  // ── Tasks ──

  async getTasks(): Promise<AgentTask[]> {
    return db.select().from(agentTasks).orderBy(desc(agentTasks.id)).all();
  }

  async getTasksBySession(sessionId: string): Promise<AgentTask[]> {
    return db.select().from(agentTasks)
      .where(eq(agentTasks.sessionId, sessionId))
      .orderBy(desc(agentTasks.id))
      .all();
  }

  async getTasksByWorkspace(workspaceId: number): Promise<AgentTask[]> {
    return db.select().from(agentTasks)
      .where(eq(agentTasks.workspaceId, workspaceId))
      .orderBy(desc(agentTasks.id))
      .all();
  }

  async getTask(id: number): Promise<AgentTask | undefined> {
    return db.select().from(agentTasks).where(eq(agentTasks.id, id)).get();
  }

  async createTask(task: InsertAgentTask): Promise<AgentTask> {
    const allTasks = db.select().from(agentTasks).all();
    const maxPos = allTasks.reduce((max, t) => Math.max(max, t.queuePosition || 0), 0);
    
    return db.insert(agentTasks).values({
      ...task,
      status: "queued",
      plan: "[]",
      queuePosition: maxPos + 1,
      createdAt: new Date().toISOString(),
    }).returning().get();
  }

  async updateTaskStatus(id: number, status: string, plan?: string): Promise<AgentTask | undefined> {
    const updates: Record<string, any> = { status };
    if (plan !== undefined) updates.plan = plan;
    return db.update(agentTasks)
      .set(updates)
      .where(eq(agentTasks.id, id))
      .returning()
      .get();
  }

  async getQueuedTasks(): Promise<AgentTask[]> {
    return db.select().from(agentTasks)
      .where(eq(agentTasks.status, "queued"))
      .orderBy(asc(agentTasks.queuePosition))
      .all();
  }

  async getRunningTask(): Promise<AgentTask | undefined> {
    return db.select().from(agentTasks)
      .where(eq(agentTasks.status, "running"))
      .get();
  }

  async getNextQueuedTask(): Promise<AgentTask | undefined> {
    return db.select().from(agentTasks)
      .where(eq(agentTasks.status, "queued"))
      .orderBy(asc(agentTasks.queuePosition))
      .get();
  }

  // ── Sessions ──

  async getSessions(): Promise<{ sessionId: string; taskCount: number; lastActivity: string }[]> {
    const tasks = db.select().from(agentTasks).orderBy(desc(agentTasks.id)).all();
    const sessMap = new Map<string, { count: number; last: string }>();
    for (const t of tasks) {
      const sid = t.sessionId || "default";
      const existing = sessMap.get(sid);
      if (existing) {
        existing.count++;
        if (t.createdAt > existing.last) existing.last = t.createdAt;
      } else {
        sessMap.set(sid, { count: 1, last: t.createdAt });
      }
    }
    if (!sessMap.has("default")) {
      sessMap.set("default", { count: 0, last: new Date().toISOString() });
    }
    return Array.from(sessMap.entries()).map(([sessionId, data]) => ({
      sessionId,
      taskCount: data.count,
      lastActivity: data.last,
    }));
  }

  async getSessionsByWorkspace(workspaceId: number): Promise<{ sessionId: string; taskCount: number; lastActivity: string }[]> {
    const tasks = db.select().from(agentTasks)
      .where(eq(agentTasks.workspaceId, workspaceId))
      .orderBy(desc(agentTasks.id))
      .all();
    const sessMap = new Map<string, { count: number; last: string }>();
    for (const t of tasks) {
      const sid = t.sessionId || "default";
      const existing = sessMap.get(sid);
      if (existing) {
        existing.count++;
        if (t.createdAt > existing.last) existing.last = t.createdAt;
      } else {
        sessMap.set(sid, { count: 1, last: t.createdAt });
      }
    }
    if (!sessMap.has("default")) {
      sessMap.set("default", { count: 0, last: new Date().toISOString() });
    }
    return Array.from(sessMap.entries()).map(([sessionId, data]) => ({
      sessionId,
      taskCount: data.count,
      lastActivity: data.last,
    }));
  }

  // ── Logs ──

  async getLogsForTask(taskId: number): Promise<AgentLog[]> {
    return db.select().from(agentLogs).where(eq(agentLogs.taskId, taskId)).all();
  }

  async getLogsForSession(sessionId: string): Promise<AgentLog[]> {
    return db.select().from(agentLogs)
      .where(eq(agentLogs.sessionId, sessionId))
      .orderBy(desc(agentLogs.id))
      .all();
  }

  async addLog(log: InsertAgentLog): Promise<AgentLog> {
    return db.insert(agentLogs).values(log).returning().get();
  }

  // ── Step snapshots ──

  async getStepSnapshots(taskId: number): Promise<StepSnapshot[]> {
    return db.select().from(stepSnapshots)
      .where(eq(stepSnapshots.taskId, taskId))
      .orderBy(asc(stepSnapshots.stepIndex))
      .all();
  }

  async addStepSnapshot(snapshot: InsertStepSnapshot): Promise<StepSnapshot> {
    return db.insert(stepSnapshots).values(snapshot).returning().get();
  }

  // ── Export ──

  async exportSession(workspaceId: number, sessionId: string): Promise<any> {
    const tasks = db.select().from(agentTasks)
      .where(and(eq(agentTasks.workspaceId, workspaceId), eq(agentTasks.sessionId, sessionId)))
      .orderBy(desc(agentTasks.id))
      .all();

    const logs = db.select().from(agentLogs)
      .where(eq(agentLogs.sessionId, sessionId))
      .orderBy(asc(agentLogs.id))
      .all();

    const tabs = db.select().from(sessionTabs)
      .where(and(eq(sessionTabs.workspaceId, workspaceId), eq(sessionTabs.sessionId, sessionId)))
      .orderBy(asc(sessionTabs.id))
      .all();

    const ws = await this.getWorkspace(workspaceId);

    return {
      exportedAt: new Date().toISOString(),
      workspace: ws ? { id: ws.id, name: ws.name } : null,
      sessionId,
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        targetUrl: t.targetUrl,
        goal: t.goal,
        status: t.status,
        plan: t.plan,
        createdAt: t.createdAt,
      })),
      logs: logs.map(l => ({
        id: l.id,
        taskId: l.taskId,
        stepIndex: l.stepIndex,
        action: l.action,
        detail: l.detail,
        status: l.status,
        timestamp: l.timestamp,
      })),
      tabs: tabs.map(t => ({
        id: t.id,
        label: t.label,
        url: t.url,
        isActive: t.isActive,
      })),
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
    const task = db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).get();
    if (!task) return null;

    const logs = db.select().from(agentLogs)
      .where(eq(agentLogs.taskId, taskId))
      .orderBy(asc(agentLogs.id))
      .all();

    const steps = db.select().from(stepSnapshots)
      .where(eq(stepSnapshots.taskId, taskId))
      .orderBy(asc(stepSnapshots.stepIndex))
      .all();

    return {
      exportedAt: new Date().toISOString(),
      task: {
        id: task.id,
        workspaceId: task.workspaceId,
        sessionId: task.sessionId,
        title: task.title,
        targetUrl: task.targetUrl,
        goal: task.goal,
        status: task.status,
        plan: task.plan,
        createdAt: task.createdAt,
      },
      logs: logs.map(l => ({
        id: l.id,
        stepIndex: l.stepIndex,
        action: l.action,
        detail: l.detail,
        status: l.status,
        timestamp: l.timestamp,
      })),
      steps: steps.map(s => ({
        stepIndex: s.stepIndex,
        phase: s.phase,
        action: s.action,
        status: s.status,
        detail: s.detail,
        timestamp: s.timestamp,
        hasScreenshot: !!s.screenshotBase64,
        snapshotJson: s.snapshotJson,
      })),
      summary: {
        totalSteps: steps.length,
        totalLogs: logs.length,
        hasErrors: logs.some(l => l.status === "error"),
      },
    };
  }

  // ── Kwork Leads ──

  async getKworkLeads(): Promise<KworkLead[]> {
    return db.select().from(kworkLeads).orderBy(desc(kworkLeads.id)).all();
  }

  async getKworkLead(id: number): Promise<KworkLead | undefined> {
    return db.select().from(kworkLeads).where(eq(kworkLeads.id, id)).get();
  }

  async createKworkLead(lead: Omit<KworkLead, "id" | "createdAt"> & { fitScore: number; recommendation: string; whyFits: string; keyRisks: string }): Promise<KworkLead> {
    return db.insert(kworkLeads).values({
      ...lead,
      createdAt: new Date().toISOString(),
    }).returning().get();
  }

  async updateKworkLead(id: number, updates: Partial<KworkLead>): Promise<KworkLead | undefined> {
    return db.update(kworkLeads)
      .set(updates)
      .where(eq(kworkLeads.id, id))
      .returning()
      .get();
  }

  async deleteKworkLead(id: number): Promise<void> {
    db.delete(kworkLeads).where(eq(kworkLeads.id, id)).run();
  }

  async seedKworkLeads(): Promise<void> {
    const existing = db.select().from(kworkLeads).all();
    if (existing.length > 0) return; // Already seeded

    const now = new Date().toISOString();
    const seeds = [
      {
        source: "email" as const,
        sourceRaw: "Kwork email digest — March 2026",
        title: "Разработка AI-агента для автоматизации работы с CRM",
        budget: 120000,
        budgetRaw: "120 000 ₽",
        orderUrl: null,
        brief: "Нужен AI-агент, который будет автоматически обрабатывать входящие заявки в AmoCRM, классифицировать их по приоритету, генерировать ответы с помощью GPT и создавать задачи для менеджеров. Интеграция через webhook + REST API.",
        category: "AI / Автоматизация",
        flagFitsProfile: 1,
        flagNeedsCall: 0,
        flagNeedsAccess: 1,
        flagNeedsDesign: 0,
        flagNeedsMobile: 0,
        flagCloudVmFit: 1,
        fitScore: 88,
        recommendation: "strong_fit",
        whyFits: JSON.stringify(["Бюджет 120 000 ₽ — проходит базовый фильтр", "Бюджет ≥ 100 000 ₽ — высокий приоритет", "AI/LLM fit: ai, gpt, openai", "Automation fit: автоматизац, webhook", "Integration fit: api, webhook, crm", "Подходит для Computer + Cloud VM workflow"]),
        keyRisks: JSON.stringify(["Нужны доступы к аккаунтам заказчика — риск блокировок и задержек"]),
        status: "new" as const,
        isShortlisted: 0,
        computerTaskId: null,
        receivedAt: "2026-03-28T09:15:00.000Z",
      },
      {
        source: "email" as const,
        sourceRaw: "Kwork email digest — March 2026",
        title: "Telegram-бот для онлайн-школы: запись, оплата, уведомления",
        budget: 75000,
        budgetRaw: "75 000 ₽",
        orderUrl: null,
        brief: "Бот для онлайн-школы английского языка. Функции: запись учеников на занятия, интеграция с ЮKassa для оплаты, автоматические напоминания за 1 час до урока, личный кабинет ученика в боте. Нужна admin-панель для управления расписанием.",
        category: "Telegram боты",
        flagFitsProfile: 1,
        flagNeedsCall: 0,
        flagNeedsAccess: 0,
        flagNeedsDesign: 0,
        flagNeedsMobile: 0,
        flagCloudVmFit: 1,
        fitScore: 77,
        recommendation: "strong_fit",
        whyFits: JSON.stringify(["Бюджет 75 000 ₽ — проходит базовый фильтр", "Бюджет ≥ 75 000 ₽ — хороший приоритет", "Telegram bot fit: telegram, бот", "Integration fit: api, webhook", "Cloud/infra fit: сервер, deploy"]),
        keyRisks: JSON.stringify([]),
        status: "new" as const,
        isShortlisted: 1,
        computerTaskId: null,
        receivedAt: "2026-03-27T14:30:00.000Z",
      },
      {
        source: "manual" as const,
        sourceRaw: "",
        title: "Парсер и мониторинг цен на маркетплейсах (Ozon, Wildberries)",
        budget: 55000,
        budgetRaw: "55 000 ₽",
        orderUrl: "https://kwork.ru/projects/12345",
        brief: "Нужен скрипт для мониторинга цен конкурентов на Ozon и Wildberries. Результаты выгружать в Google Sheets раз в 4 часа. Playwright или Selenium. Работает на VPS.",
        category: "Парсинг / автоматизация",
        flagFitsProfile: 1,
        flagNeedsCall: 0,
        flagNeedsAccess: 0,
        flagNeedsDesign: 0,
        flagNeedsMobile: 0,
        flagCloudVmFit: 1,
        fitScore: 73,
        recommendation: "strong_fit",
        whyFits: JSON.stringify(["Бюджет 55 000 ₽ — проходит базовый фильтр", "Browser automation fit: playwright, парсинг", "Automation fit: automation, парсинг, скрипт", "Cloud/infra fit: vps, сервер", "Помечено: подходит под профиль"]),
        keyRisks: JSON.stringify([]),
        status: "opened" as const,
        isShortlisted: 1,
        computerTaskId: null,
        receivedAt: "2026-03-26T11:00:00.000Z",
      },
      {
        source: "email" as const,
        sourceRaw: "Kwork email digest — March 2026",
        title: "Разработка мобильного приложения под iOS и Android для доставки еды",
        budget: 200000,
        budgetRaw: "200 000 ₽",
        orderUrl: null,
        brief: "",
        category: "Мобильные приложения",
        flagFitsProfile: 0,
        flagNeedsCall: 1,
        flagNeedsAccess: 0,
        flagNeedsDesign: 1,
        flagNeedsMobile: 1,
        flagCloudVmFit: 0,
        fitScore: 18,
        recommendation: "reject",
        whyFits: JSON.stringify(["Бюджет 200 000 ₽ — проходит базовый фильтр", "Бюджет ≥ 100 000 ₽ — высокий приоритет"]),
        keyRisks: JSON.stringify(["Требуется мобильное приложение / публикация в сторах — не в профиле", "Требуется ручной созвон / встреча — снижает async-эффективность", "Требуется дизайн — не в core профиле", "Полное ТЗ недоступно — получено только из email-дайджеста; нужно открыть страницу заказа"]),
        status: "rejected" as const,
        isShortlisted: 0,
        computerTaskId: null,
        receivedAt: "2026-03-25T08:00:00.000Z",
      },
      {
        source: "email" as const,
        sourceRaw: "Kwork email digest — March 2026",
        title: "N8N workflow: автоматизация входящих лидов из форм сайта в Notion + Telegram",
        budget: 60000,
        budgetRaw: "60 000 ₽",
        orderUrl: null,
        brief: "Есть несколько форм на сайте (Tilda). Нужно настроить n8n: при заполнении формы — запись в Notion базу, уведомление в Telegram-канал, письмо на email. Хостинг n8n на их VPS или cloud.",
        category: "Интеграции / автоматизация",
        flagFitsProfile: 1,
        flagNeedsCall: 0,
        flagNeedsAccess: 1,
        flagNeedsDesign: 0,
        flagNeedsMobile: 0,
        flagCloudVmFit: 1,
        fitScore: 69,
        recommendation: "review_manually",
        whyFits: JSON.stringify(["Бюджет 60 000 ₽ — проходит базовый фильтр", "Automation fit: автоматизаци, workflow", "Telegram bot fit: telegram", "Integration fit: webhook, notion, n8n", "Cloud/infra fit: cloud, vps"]),
        keyRisks: JSON.stringify(["Нужны доступы к аккаунтам заказчика — риск блокировок и задержек"]),
        status: "new" as const,
        isShortlisted: 0,
        computerTaskId: null,
        receivedAt: "2026-03-29T16:45:00.000Z",
      },
      {
        source: "manual" as const,
        sourceRaw: "",
        title: "Разработка чат-бота для клиентской поддержки с GPT-4o и базой знаний",
        budget: 90000,
        budgetRaw: "90 000 ₽",
        orderUrl: "https://kwork.ru/projects/67890",
        brief: "Нужен умный бот для Telegram и WhatsApp. Работает на GPT-4o, отвечает на вопросы на основе загруженной базы знаний (PDF + текст). Переключение на живого оператора если бот не уверен. Аналитика обращений.",
        category: "AI / Чат-боты",
        flagFitsProfile: 1,
        flagNeedsCall: 0,
        flagNeedsAccess: 0,
        flagNeedsDesign: 0,
        flagNeedsMobile: 0,
        flagCloudVmFit: 1,
        fitScore: 84,
        recommendation: "strong_fit",
        whyFits: JSON.stringify(["Бюджет 90 000 ₽ — проходит базовый фильтр", "AI/LLM fit: gpt, llm, ai", "Telegram bot fit: telegram, бот", "Integration fit: api", "Подходит для Computer + Cloud VM workflow", "Помечено: подходит под профиль"]),
        keyRisks: JSON.stringify([]),
        status: "new" as const,
        isShortlisted: 0,
        computerTaskId: null,
        receivedAt: "2026-03-30T07:00:00.000Z",
      },
      {
        source: "email" as const,
        sourceRaw: "Kwork email digest — March 2026",
        title: "SEO-продвижение + контент для интернет-магазина",
        budget: 30000,
        budgetRaw: "30 000 ₽",
        orderUrl: null,
        brief: "Продвижение магазина одежды. SEO-аудит, написание текстов для карточек товаров, настройка Яндекс.Вебмастер.",
        category: "SEO / Маркетинг",
        flagFitsProfile: 0,
        flagNeedsCall: 0,
        flagNeedsAccess: 0,
        flagNeedsDesign: 0,
        flagNeedsMobile: 0,
        flagCloudVmFit: 0,
        fitScore: 2,
        recommendation: "reject",
        whyFits: JSON.stringify([]),
        keyRisks: JSON.stringify(["Бюджет 30 000 ₽ ниже порога 50 000 ₽", "Низкие бюджеты несовместимы с AI/automation профилем"]),
        status: "rejected" as const,
        isShortlisted: 0,
        computerTaskId: null,
        receivedAt: "2026-03-28T13:00:00.000Z",
      },
    ];

    for (const seed of seeds) {
      db.insert(kworkLeads).values({
        ...seed,
        createdAt: new Date().toISOString(),
      }).run();
    }
  }
}

export const storage = new DatabaseStorage();
