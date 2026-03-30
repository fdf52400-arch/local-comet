import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Workspaces ───────────────────────────────────────────────────────────────

export const workspaces = sqliteTable("workspaces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isActive: integer("is_active").notNull().default(0), // 0 | 1
  createdAt: text("created_at").notNull(),
});

export const insertWorkspaceSchema = createInsertSchema(workspaces).omit({ id: true, createdAt: true });
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
export type Workspace = typeof workspaces.$inferSelect;

// ─── Session Tabs ─────────────────────────────────────────────────────────────

export const sessionTabs = sqliteTable("session_tabs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: integer("workspace_id").notNull().default(1),
  sessionId: text("session_id").notNull().default("default"),
  label: text("label").notNull().default("Tab"),
  url: text("url").notNull().default(""),
  isActive: integer("is_active").notNull().default(0), // 0 | 1
  previewState: text("preview_state").notNull().default("{}"), // JSON: PreviewState
  snapshotJson: text("snapshot_json"), // JSON: PageSnapshot
  selectedElement: text("selected_element"), // JSON: DOMElement | null
  historyJson: text("history_json").notNull().default("[]"), // JSON: step history for this tab
  createdAt: text("created_at").notNull(),
});

export const insertSessionTabSchema = createInsertSchema(sessionTabs).omit({ id: true, createdAt: true });
export type InsertSessionTab = z.infer<typeof insertSessionTabSchema>;
export type SessionTab = typeof sessionTabs.$inferSelect;

// ─── Provider settings ────────────────────────────────────────────────────────
//
// providerType values:
//   ollama            — local Ollama server (real connection + model list)
//                       Works only when the app runs locally next to Ollama.
//   lmstudio          — local LM Studio    (real connection + model list)
//                       Works only when the app runs locally next to LM Studio.
//   openai_compatible — any OpenAI-compatible endpoint (real check + chat via baseUrl+port+apiKey)
//   anthropic         — Anthropic API      (real check + chat via stored apiKey)
//   openai            — OpenAI API         (real check + model list + chat via stored apiKey)
//   gemini            — Google Gemini API  (real check + model list + chat via stored apiKey)

export const providerSettings = sqliteTable("provider_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerType: text("provider_type").notNull().default("ollama"),
  // ollama | lmstudio | openai_compatible | anthropic | openai | gemini
  baseUrl: text("base_url").notNull().default("http://127.0.0.1"),
  port: integer("port").notNull().default(11436), // default for local Ollama instance
  model: text("model").notNull().default(""),
  apiKey: text("api_key").notNull().default(""), // for cloud/external providers
  temperature: text("temperature").notNull().default("0.7"),
  maxTokens: integer("max_tokens").notNull().default(2048),
  safetyMode: text("safety_mode").notNull().default("readonly"), // readonly | confirm | full
});

export const insertProviderSettingsSchema = createInsertSchema(providerSettings).omit({ id: true });
export type InsertProviderSettings = z.infer<typeof insertProviderSettingsSchema>;
export type ProviderSettings = typeof providerSettings.$inferSelect;

// Provider types that require local server access (cannot work from a hosted/public preview)
// because they connect to localhost on the user's machine.
export const LOCAL_PROVIDERS = ["ollama", "lmstudio"] as const;
// Cloud API providers — work from anywhere with a valid API key.
export const CLOUD_PROVIDERS = ["openai", "anthropic", "gemini", "openai_compatible"] as const;
// Legacy alias kept for backwards compatibility
export const CONFIG_ONLY_PROVIDERS = CLOUD_PROVIDERS;
export type LocalProviderType = typeof LOCAL_PROVIDERS[number];
export type CloudProviderType = typeof CLOUD_PROVIDERS[number];
// @deprecated use CloudProviderType
export type ConfigOnlyProviderType = CloudProviderType;
export type ProviderType = LocalProviderType | CloudProviderType;

// ─── Agent tasks — now with workspaceId ───────────────────────────────────────

export const agentTasks = sqliteTable("agent_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: integer("workspace_id").notNull().default(1),
  sessionId: text("session_id").notNull().default("default"),
  title: text("title").notNull(),
  targetUrl: text("target_url").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("queued"), // queued | running | waiting_confirm | completed | error | cancelled
  plan: text("plan").notNull().default("[]"), // JSON array of steps
  queuePosition: integer("queue_position").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({ id: true, status: true, plan: true, queuePosition: true, createdAt: true });
export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
export type AgentTask = typeof agentTasks.$inferSelect;

// ─── Agent execution log entries ──────────────────────────────────────────────

export const agentLogs = sqliteTable("agent_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  workspaceId: integer("workspace_id").notNull().default(1),
  sessionId: text("session_id").notNull().default("default"),
  stepIndex: integer("step_index").notNull().default(0),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  status: text("status").notNull().default("info"), // info | success | warning | error
  timestamp: text("timestamp").notNull(),
});

export const insertAgentLogSchema = createInsertSchema(agentLogs).omit({ id: true });
export type InsertAgentLog = z.infer<typeof insertAgentLogSchema>;
export type AgentLog = typeof agentLogs.$inferSelect;

// ─── Step snapshots — stores state at each step for replay ────────────────────

export const stepSnapshots = sqliteTable("step_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  workspaceId: integer("workspace_id").notNull().default(1),
  sessionId: text("session_id").notNull().default("default"),
  stepIndex: integer("step_index").notNull(),
  phase: text("phase").notNull().default(""),
  action: text("action").notNull().default(""),
  status: text("status").notNull().default("info"),
  detail: text("detail").notNull().default(""),
  timestamp: text("timestamp").notNull(),
  screenshotBase64: text("screenshot_base64"), // nullable, can be large
  snapshotJson: text("snapshot_json"), // JSON of PageSnapshot
});

export const insertStepSnapshotSchema = createInsertSchema(stepSnapshots).omit({ id: true });
export type InsertStepSnapshot = z.infer<typeof insertStepSnapshotSchema>;
export type StepSnapshot = typeof stepSnapshots.$inferSelect;

// ─── Demo scenarios ───────────────────────────────────────────────────────────

export interface DemoScenario {
  id: string;
  title: string;
  description: string;
  targetUrl: string;
  goal: string;
}

// ─── Utility types ────────────────────────────────────────────────────────────

export type TaskStatus = "queued" | "running" | "waiting_confirm" | "completed" | "error" | "cancelled";
export type RiskLevel = "low" | "medium" | "high";

// ─── Kwork Leads ──────────────────────────────────────────────────────────────

export const kworkLeads = sqliteTable("kwork_leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Source metadata
  source: text("source").notNull().default("manual"), // email | manual | browser
  sourceRaw: text("source_raw").notNull().default(""), // raw email snippet or HTML
  // Project info
  title: text("title").notNull(),
  budget: integer("budget").notNull().default(0), // in RUB
  budgetRaw: text("budget_raw").notNull().default(""), // original string e.g. "от 50 000 ₽"
  orderUrl: text("order_url"), // nullable — link to kwork order page
  brief: text("brief").notNull().default(""), // extracted or entered brief
  category: text("category").notNull().default(""), // e.g. "Чат-боты", "Web"
  // Flags (0|1 stored as integers)
  flagFitsProfile: integer("flag_fits_profile").notNull().default(0),
  flagNeedsCall: integer("flag_needs_call").notNull().default(0),
  flagNeedsAccess: integer("flag_needs_access").notNull().default(0),
  flagNeedsDesign: integer("flag_needs_design").notNull().default(0),
  flagNeedsMobile: integer("flag_needs_mobile").notNull().default(0),
  flagCloudVmFit: integer("flag_cloud_vm_fit").notNull().default(0),
  // Scoring output (computed and stored)
  fitScore: integer("fit_score").notNull().default(0), // 0–100
  recommendation: text("recommendation").notNull().default("review_manually"), // reject | review_manually | strong_fit
  whyFits: text("why_fits").notNull().default("[]"), // JSON string[]
  keyRisks: text("key_risks").notNull().default("[]"), // JSON string[]
  // Workflow state
  status: text("status").notNull().default("new"), // new | shortlisted | rejected | opened | in_review
  isShortlisted: integer("is_shortlisted").notNull().default(0),
  computerTaskId: integer("computer_task_id"), // nullable — linked agent task
  // Timestamps
  receivedAt: text("received_at").notNull(), // ISO
  createdAt: text("created_at").notNull(),
});

export const insertKworkLeadSchema = createInsertSchema(kworkLeads).omit({
  id: true,
  fitScore: true,
  recommendation: true,
  whyFits: true,
  keyRisks: true,
  isShortlisted: true,
  computerTaskId: true,
  createdAt: true,
});
export type InsertKworkLead = z.infer<typeof insertKworkLeadSchema>;
export type KworkLead = typeof kworkLeads.$inferSelect;

export type KworkRecommendation = "reject" | "review_manually" | "strong_fit";
