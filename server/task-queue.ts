/**
 * Local Comet — Task Queue Manager v5
 * 
 * Manages task lifecycle: queued → running → (waiting_confirm) → completed/error
 * Auto-starts next queued task after current one finishes.
 */

import { storage } from "./storage";
import { broadcast } from "./event-bus";
import { runAgentLoop, type AgentRunConfig, getSessionState, setSessionState, getSelectedElement } from "./agent-engine";
import type { AgentTask } from "@shared/schema";

const DEFAULT_MAX_STEPS = 15; // Increased: search tasks need navigate + dom_snapshot + fill + navigate + extract + links + summarize

interface QueueConfig {
  maxSteps: number;
  providerConfig: any;
  safetyMode: string;
}

let isProcessing = false;

/**
 * Per-task config store: taskId -> QueueConfig.
 * Ensures each queued task uses the config it was submitted with,
 * even if a newer task is enqueued with different settings while the queue runs.
 */
const taskConfigs = new Map<number, QueueConfig>();

/**
 * Enqueue a task and start processing if not already running
 */
export async function enqueueTask(
  task: AgentTask,
  config: QueueConfig,
): Promise<void> {
  // Store per-task config so it survives concurrent enqueue calls
  taskConfigs.set(task.id, config);

  broadcast({
    type: "queue_update" as any,
    taskId: task.id,
    detail: `Задача #${task.id} добавлена в очередь`,
    data: { 
      taskId: task.id, 
      sessionId: task.sessionId,
      status: "queued",
      title: task.title,
    },
    timestamp: new Date().toISOString(),
  });

  // Start processing if not already
  if (!isProcessing) {
    processQueue(config);
  }
}

/** Default fallback config used when a task's own config is missing */
const DEFAULT_CONFIG: QueueConfig = {
  maxSteps: DEFAULT_MAX_STEPS,
  providerConfig: null,
  safetyMode: "readonly",
};

/**
 * Process the task queue — runs tasks one at a time
 */
async function processQueue(fallbackConfig: QueueConfig): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (true) {
      // Check for a running task first (could be from a restart)
      let runningTask = await storage.getRunningTask();
      
      // If no running task, get next queued
      if (!runningTask) {
        const nextTask = await storage.getNextQueuedTask();
        if (!nextTask) break; // Nothing to process
        runningTask = nextTask;
      }

      // Use per-task config if available, fall back to the config provided at queue start
      const taskConfig = taskConfigs.get(runningTask.id) ?? fallbackConfig ?? DEFAULT_CONFIG;
      await executeTask(runningTask, taskConfig);

      // Clean up stored config after execution
      taskConfigs.delete(runningTask.id);

      // Small delay between tasks
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Execute a single task
 */
async function executeTask(task: AgentTask, config: QueueConfig): Promise<void> {
  const sessionId = task.sessionId || "default";

  try {
    // Update status to running
    await storage.updateTaskStatus(task.id, "running");
    
    broadcast({
      type: "queue_update" as any,
      taskId: task.id,
      detail: `Задача #${task.id} запущена`,
      data: { taskId: task.id, sessionId, status: "running", title: task.title },
      timestamp: new Date().toISOString(),
    });

    await storage.addLog({
      taskId: task.id,
      sessionId,
      workspaceId: task.workspaceId || 1,
      stepIndex: 0,
      action: "init",
      detail: `Начало задачи: ${task.goal}`,
      status: "info",
      timestamp: new Date().toISOString(),
    });

    // Get selected element for this session
    const selElement = getSelectedElement(sessionId);

    const runConfig: AgentRunConfig = {
      url: task.targetUrl,
      goal: task.goal,
      taskId: task.id,
      sessionId,
      safetyMode: config.safetyMode,
      maxSteps: config.maxSteps || DEFAULT_MAX_STEPS,
      providerConfig: config.providerConfig,
      selectedElement: selElement,
    };

    const { results, snapshots, planSource } = await runAgentLoop(runConfig);

    // Finalize
    const hasErrors = results.some(r => r.status === "error");
    const finalStatus = hasErrors ? "error" : "completed";
    const planJson = JSON.stringify(results.map(r => ({ action: r.action, status: r.status })));
    await storage.updateTaskStatus(task.id, finalStatus, planJson);

    await storage.addLog({
      taskId: task.id,
      sessionId,
      workspaceId: task.workspaceId || 1,
      stepIndex: results.length + 1,
      action: "finish",
      detail: hasErrors ? "Задача завершена с ошибками" : "Задача выполнена успешно",
      status: hasErrors ? "error" : "success",
      timestamp: new Date().toISOString(),
    });

    broadcast({
      type: "queue_update" as any,
      taskId: task.id,
      detail: `Задача #${task.id} ${finalStatus}`,
      data: { taskId: task.id, sessionId, status: finalStatus, title: task.title, planSource },
      timestamp: new Date().toISOString(),
    });

  } catch (err: any) {
    console.error(`Task ${task.id} failed:`, err);
    await storage.updateTaskStatus(task.id, "error");
    
    await storage.addLog({
      taskId: task.id,
      sessionId,
      workspaceId: task.workspaceId || 1,
      stepIndex: 0,
      action: "error",
      detail: `Ошибка: ${err.message}`,
      status: "error",
      timestamp: new Date().toISOString(),
    });

    broadcast({
      type: "queue_update" as any,
      taskId: task.id,
      detail: `Задача #${task.id} ошибка: ${err.message}`,
      data: { taskId: task.id, sessionId, status: "error" },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Cancel a queued task
 */
export async function cancelTask(taskId: number): Promise<boolean> {
  const task = await storage.getTask(taskId);
  if (!task) return false;
  if (task.status !== "queued") return false;
  
  await storage.updateTaskStatus(taskId, "cancelled");
  
  broadcast({
    type: "queue_update" as any,
    taskId,
    detail: `Задача #${taskId} отменена`,
    data: { taskId, sessionId: task.sessionId, status: "cancelled" },
    timestamp: new Date().toISOString(),
  });
  
  return true;
}

/**
 * Get queue status
 */
export async function getQueueStatus(): Promise<{
  isProcessing: boolean;
  runningTask: AgentTask | undefined;
  queuedTasks: AgentTask[];
}> {
  return {
    isProcessing,
    runningTask: await storage.getRunningTask(),
    queuedTasks: await storage.getQueuedTasks(),
  };
}

export function isQueueProcessing(): boolean {
  return isProcessing;
}
