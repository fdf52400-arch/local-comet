import {
  type ProviderSettings, type InsertProviderSettings, providerSettings,
  type AgentTask, type InsertAgentTask, agentTasks,
  type AgentLog, type InsertAgentLog, agentLogs,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

export interface IStorage {
  // Provider settings
  getSettings(): Promise<ProviderSettings | undefined>;
  upsertSettings(settings: InsertProviderSettings): Promise<ProviderSettings>;

  // Tasks
  getTasks(): Promise<AgentTask[]>;
  getTask(id: number): Promise<AgentTask | undefined>;
  createTask(task: InsertAgentTask): Promise<AgentTask>;
  updateTaskStatus(id: number, status: string, plan?: string): Promise<AgentTask | undefined>;

  // Logs
  getLogsForTask(taskId: number): Promise<AgentLog[]>;
  addLog(log: InsertAgentLog): Promise<AgentLog>;
}

export class DatabaseStorage implements IStorage {
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

  async getTasks(): Promise<AgentTask[]> {
    return db.select().from(agentTasks).orderBy(desc(agentTasks.id)).all();
  }

  async getTask(id: number): Promise<AgentTask | undefined> {
    return db.select().from(agentTasks).where(eq(agentTasks.id, id)).get();
  }

  async createTask(task: InsertAgentTask): Promise<AgentTask> {
    return db.insert(agentTasks).values({
      ...task,
      status: "pending",
      plan: "[]",
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

  async getLogsForTask(taskId: number): Promise<AgentLog[]> {
    return db.select().from(agentLogs).where(eq(agentLogs.taskId, taskId)).all();
  }

  async addLog(log: InsertAgentLog): Promise<AgentLog> {
    return db.insert(agentLogs).values(log).returning().get();
  }
}

export const storage = new DatabaseStorage();
