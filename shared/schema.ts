import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Provider settings
export const providerSettings = sqliteTable("provider_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerType: text("provider_type").notNull().default("ollama"), // ollama | lmstudio
  baseUrl: text("base_url").notNull().default("http://localhost"),
  port: integer("port").notNull().default(11434),
  model: text("model").notNull().default(""),
  temperature: text("temperature").notNull().default("0.7"),
  maxTokens: integer("max_tokens").notNull().default(2048),
  safetyMode: text("safety_mode").notNull().default("readonly"), // readonly | confirm | full
});

export const insertProviderSettingsSchema = createInsertSchema(providerSettings).omit({ id: true });
export type InsertProviderSettings = z.infer<typeof insertProviderSettingsSchema>;
export type ProviderSettings = typeof providerSettings.$inferSelect;

// Agent tasks
export const agentTasks = sqliteTable("agent_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  targetUrl: text("target_url").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("pending"), // pending | planning | running | completed | error
  plan: text("plan").notNull().default("[]"), // JSON array of steps
  createdAt: text("created_at").notNull(),
});

export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({ id: true, status: true, plan: true, createdAt: true });
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
export type AgentTask = typeof agentTasks.$inferSelect;

// Agent execution log entries
export const agentLogs = sqliteTable("agent_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  stepIndex: integer("step_index").notNull().default(0),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  status: text("status").notNull().default("info"), // info | success | warning | error
  timestamp: text("timestamp").notNull(),
});

export const insertAgentLogSchema = createInsertSchema(agentLogs).omit({ id: true });
export type InsertAgentLog = z.infer<typeof insertAgentLogSchema>;
export type AgentLog = typeof agentLogs.$inferSelect;

// Demo scenarios
export interface DemoScenario {
  id: string;
  title: string;
  description: string;
  targetUrl: string;
  goal: string;
}
