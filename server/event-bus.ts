/**
 * Local Comet — Server-Sent Events (SSE) event bus v5
 * 
 * Broadcasts agent lifecycle events to connected UI clients in real time.
 * Now includes queue and session event types.
 */

import type { Response } from "express";

export type AgentEventType =
  | "planning"
  | "observation"
  | "reasoning"
  | "action"
  | "action_result"
  | "confirm_request"
  | "confirm_response"
  | "warning"
  | "error"
  | "blocked"
  | "completed"
  | "step_counter"
  | "preview_update"
  | "manual_action"
  | "queue_update"
  | "session_update";

export interface AgentEvent {
  type: AgentEventType;
  taskId: number;
  step?: number;
  maxSteps?: number;
  phase?: string;
  detail: string;
  data?: any;
  timestamp: string;
}

// Connected SSE clients
const clients = new Set<Response>();

export function addClient(res: Response): void {
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
  });
}

export function broadcast(event: AgentEvent): void {
  const data = JSON.stringify(event);
  for (const client of Array.from(clients)) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}
