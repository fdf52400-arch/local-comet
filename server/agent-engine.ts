/**
 * Local Comet — Browser Agent Engine v5
 * 
 * Session-aware agentic loop: observe → snapshot → reason → act → re-observe
 * Each session has its own preview, snapshot, selected element, and telemetry.
 * V5: Session isolation, step snapshot recording for replay, risk assessment.
 */

import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { broadcast, type AgentEvent } from "./event-bus";
import { requestPlanFromModel } from "./provider-gateway";
import { storage } from "./storage";
import type { RiskLevel } from "@shared/schema";

export interface AgentAction {
  action: string;
  params?: Record<string, string>;
}

export interface AgentStepResult {
  action: string;
  status: "success" | "error" | "warning" | "blocked" | "skipped";
  detail: string;
  data?: any;
}

/** Rich page observation with element map */
export interface DOMElement {
  tag: string;
  type: string; // "link" | "button" | "input" | "heading" | "image" | "form"
  text: string;
  href?: string;
  placeholder?: string;
  name?: string;
  index: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  textSnippet: string;
  elements: DOMElement[];
  stats: {
    links: number;
    buttons: number;
    inputs: number;
    forms: number;
    images: number;
    headings: number;
  };
  headings: string[];
  metaDescription: string;
}

/** Preview state — screenshot + snapshot + sync info */
export interface PreviewState {
  screenshotBase64: string | null;
  snapshot: PageSnapshot | null;
  url: string;
  timestamp: string;
  syncId: number;
  currentAction: string | null;
}

export interface AgentRunConfig {
  url: string;
  goal: string;
  taskId: number;
  sessionId: string;
  safetyMode: string;
  maxSteps: number;
  providerConfig?: any;
  selectedElement?: DOMElement | null;
}

// ─── Session State Management ────────────────────────────────────────────────

interface SessionState {
  preview: PreviewState;
  selectedElement: DOMElement | null;
  lastSnapshot: PageSnapshot | null;
}

const sessionStates = new Map<string, SessionState>();

function getOrCreateSession(sessionId: string): SessionState {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = {
      preview: {
        screenshotBase64: null,
        snapshot: null,
        url: "",
        timestamp: new Date().toISOString(),
        syncId: 0,
        currentAction: null,
      },
      selectedElement: null,
      lastSnapshot: null,
    };
    sessionStates.set(sessionId, state);
  }
  return state;
}

export function getSessionState(sessionId: string): SessionState {
  return getOrCreateSession(sessionId);
}

export function setSessionState(sessionId: string, update: Partial<SessionState>): void {
  const state = getOrCreateSession(sessionId);
  Object.assign(state, update);
}

export function getAllSessions(): string[] {
  return Array.from(sessionStates.keys());
}

// Allowed safe actions
const SAFE_ACTIONS = new Set([
  "navigate", "read_title", "extract_text", "find_links", "find_buttons",
  "click_link", "fill_input", "summarize_page", "screenshot_description",
  "dom_snapshot", "click_button",
]);

// Actions that require confirmation in "confirm" mode
const CONFIRM_ACTIONS = new Set(["click_link", "fill_input", "click_button"]);

// Dangerous URL patterns
const DANGEROUS_URL_PATTERNS = [/javascript:/i, /data:/i, /^file:/i];

/**
 * Global shared browser instance.
 * NOTE: The task queue processes one task at a time, so a single shared browser/page
 * is safe for sequential execution. If parallel execution is ever introduced,
 * each concurrent session must get its own BrowserContext + Page.
 */
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

/** Whether the browser is currently occupied by an active agent run */
let browserLocked = false;

// Confirm flow state (keyed by taskId)
interface PendingConfirm {
  taskId: number;
  sessionId: string;
  step: number;
  action: AgentAction;
  riskLevel: RiskLevel;
  reason: string;
  resolve: (approved: boolean) => void;
}
let pendingConfirm: PendingConfirm | null = null;

export function getPendingConfirm(): PendingConfirm | null {
  return pendingConfirm;
}

export function resolveConfirm(taskId: number, approved: boolean): boolean {
  if (pendingConfirm && pendingConfirm.taskId === taskId) {
    pendingConfirm.resolve(approved);
    pendingConfirm = null;
    return true;
  }
  return false;
}

/**
 * Assess risk level of an action
 */
function assessRisk(action: AgentAction, snapshot: PageSnapshot | null): { level: RiskLevel; reason: string } {
  const actionName = action.action;
  const params = action.params || {};

  if (actionName === "fill_input") {
    // Filling forms is medium risk by default, high if it looks like a login/payment
    const placeholder = (params.placeholder || "").toLowerCase();
    if (/password|пароль|card|карт|cvv|cvc|pin/i.test(placeholder)) {
      return { level: "high", reason: "Поле выглядит как конфиденциальные данные (пароль, карта)" };
    }
    if (/email|login|логин|телефон|phone/i.test(placeholder)) {
      return { level: "medium", reason: "Поле может содержать персональные данные" };
    }
    return { level: "low", reason: "Заполнение текстового поля" };
  }

  if (actionName === "click_button") {
    const text = (params.text || "").toLowerCase();
    if (/submit|отправ|купить|buy|delete|удалить|confirm|подтверд/i.test(text)) {
      return { level: "high", reason: "Кнопка может выполнить необратимое действие" };
    }
    if (/sign|войти|register|регистр/i.test(text)) {
      return { level: "medium", reason: "Кнопка авторизации или регистрации" };
    }
    return { level: "low", reason: "Нажатие обычной кнопки" };
  }

  if (actionName === "click_link") {
    const text = (params.text || "").toLowerCase();
    if (/logout|выйти|delete|удалить/i.test(text)) {
      return { level: "high", reason: "Ссылка может выполнить деструктивное действие" };
    }
    return { level: "low", reason: "Переход по ссылке" };
  }

  return { level: "low", reason: "Безопасное действие чтения" };
}

async function waitForConfirmation(
  taskId: number,
  sessionId: string,
  step: number,
  action: AgentAction,
  snapshot: PageSnapshot | null,
): Promise<boolean> {
  const risk = assessRisk(action, snapshot);
  
  // Update task status to waiting_confirm
  await storage.updateTaskStatus(taskId, "waiting_confirm");
  
  return new Promise<boolean>((resolve) => {
    pendingConfirm = { taskId, sessionId, step, action, riskLevel: risk.level, reason: risk.reason, resolve };
    
    emit(taskId, sessionId, {
      type: "confirm_request",
      taskId,
      step,
      phase: "awaiting_confirmation",
      detail: formatConfirmMessage(action),
      data: {
        action: action.action,
        params: action.params,
        riskLevel: risk.level,
        riskReason: risk.reason,
        sessionId,
      },
      timestamp: new Date().toISOString(),
    });
    
    // Auto-timeout after 120s → deny
    setTimeout(() => {
      if (pendingConfirm && pendingConfirm.taskId === taskId && pendingConfirm.step === step) {
        pendingConfirm.resolve(false);
        pendingConfirm = null;
      }
    }, 120_000);
  });
}

function formatConfirmMessage(action: AgentAction): string {
  switch (action.action) {
    case "click_link":
      return `Агент хочет перейти по ссылке: "${action.params?.text || "?"}"`;
    case "click_button":
      return `Агент хочет нажать кнопку: "${action.params?.text || "?"}"`;
    case "fill_input":
      return `Агент хочет заполнить поле "${action.params?.placeholder || "?"}" значением "${action.params?.value || "?"}"`;
    default:
      return `Агент хочет выполнить: ${action.action}`;
  }
}

// ─── Preview management (session-scoped) ─────────────────────────────────────

export function getPreviewState(sessionId: string = "default"): PreviewState {
  return getOrCreateSession(sessionId).preview;
}

export function setSelectedElement(sessionId: string, element: DOMElement | null): void {
  getOrCreateSession(sessionId).selectedElement = element;
}

export function getSelectedElement(sessionId: string = "default"): DOMElement | null {
  return getOrCreateSession(sessionId).selectedElement;
}

async function updatePreview(sessionId: string, actionName?: string): Promise<string | null> {
  if (!page) return null;
  let screenshotBase64: string | null = null;
  try {
    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 70 });
    screenshotBase64 = screenshotBuffer.toString("base64");
    const snapshot = await takeSnapshot(page);

    const session = getOrCreateSession(sessionId);
    session.preview = {
      screenshotBase64,
      snapshot,
      url: page.url(),
      timestamp: new Date().toISOString(),
      syncId: session.preview.syncId + 1,
      currentAction: actionName || null,
    };
    session.lastSnapshot = snapshot;

    // Broadcast preview update via SSE
    broadcast({
      type: "preview_update" as any,
      taskId: 0,
      detail: `Preview обновлён (sync #${session.preview.syncId})`,
      data: {
        sessionId,
        url: session.preview.url,
        syncId: session.preview.syncId,
        timestamp: session.preview.timestamp,
        currentAction: actionName || null,
        hasScreenshot: true,
        snapshot: session.preview.snapshot,
      },
      timestamp: session.preview.timestamp,
    });
  } catch (err) {
    console.error("Preview update failed:", err);
  }
  return screenshotBase64;
}

/** Take a screenshot and return base64 */
export async function takeScreenshot(): Promise<string | null> {
  if (!page) {
    await initBrowser();
  }
  if (!page) return null;
  try {
    const buffer = await page.screenshot({ type: "jpeg", quality: 70 });
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

// ─── Browser management ───────────────────────────────────────────────────

export async function initBrowser(): Promise<void> {
  // If existing browser has crashed, clean up before re-launching
  if (browser) {
    try {
      // Quick health check: if the browser process is gone, this throws
      await browser.version();
    } catch {
      // Browser crashed or disconnected — reset all handles
      browser = null;
      context = null;
      page = null;
      browserLocked = false;
    }
  }

  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    context = await browser.newContext({
      userAgent: "LocalComet/5.0 (Browser Agent)",
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    try { await browser.close(); } catch { /* ignore errors on close */ }
    browser = null;
    context = null;
    page = null;
    browserLocked = false;
  }
}

function getPage(): Page {
  if (!page) throw new Error("Браузер не инициализирован");
  return page;
}

/** Returns true if the browser is currently running an agent task */
export function isBrowserBusy(): boolean {
  return browserLocked;
}

function isUrlSafe(url: string): boolean {
  for (const pattern of DANGEROUS_URL_PATTERNS) {
    if (pattern.test(url)) return false;
  }
  return true;
}

function emit(taskId: number, sessionId: string, event: Omit<AgentEvent, "taskId"> & { taskId?: number }): void {
  broadcast({ ...event, taskId, data: { ...event.data, sessionId } } as AgentEvent);
}

/**
 * Full DOM snapshot — produces a structured element map
 */
export async function takeSnapshot(p: Page): Promise<PageSnapshot> {
  try {
    return await p.evaluate(() => {
      const title = document.title || "";
      const url = window.location.href;
      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";

      // Text snippet
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, nav, iframe, noscript, svg").forEach(el => el.remove());
      const textSnippet = (clone.innerText || clone.textContent || "").trim().slice(0, 1500);

      // Build element map
      const elements: any[] = [];
      let idx = 0;

      // Links
      document.querySelectorAll("a[href]").forEach((el) => {
        const a = el as HTMLAnchorElement;
        const text = a.innerText?.trim().slice(0, 120);
        if (text && text.length > 0) {
          elements.push({
            tag: "a", type: "link", text, href: a.href, index: idx++,
          });
        }
      });

      // Buttons
      document.querySelectorAll("button, input[type='submit'], [role='button']").forEach((el) => {
        const text = (el as HTMLElement).innerText?.trim().slice(0, 120) || (el as HTMLInputElement).value || "";
        if (text) {
          elements.push({ tag: el.tagName.toLowerCase(), type: "button", text, index: idx++ });
        }
      });

      // Inputs
      document.querySelectorAll("input:not([type='hidden']):not([type='submit']), textarea, select").forEach((el) => {
        const inp = el as HTMLInputElement;
        elements.push({
          tag: el.tagName.toLowerCase(),
          type: "input",
          text: inp.placeholder || inp.name || inp.type || "",
          placeholder: inp.placeholder || "",
          name: inp.name || "",
          index: idx++,
        });
      });

      // Headings
      const headings: string[] = [];
      document.querySelectorAll("h1, h2, h3").forEach((el) => {
        const text = (el as HTMLElement).innerText?.trim().slice(0, 120);
        if (text) {
          elements.push({ tag: el.tagName.toLowerCase(), type: "heading", text, index: idx++ });
          headings.push(text);
        }
      });

      // Forms
      document.querySelectorAll("form").forEach((el) => {
        const action = (el as HTMLFormElement).action || "";
        elements.push({ tag: "form", type: "form", text: action, index: idx++ });
      });

      // Images with alt
      document.querySelectorAll("img[alt]").forEach((el) => {
        const alt = (el as HTMLImageElement).alt?.trim();
        if (alt) {
          elements.push({ tag: "img", type: "image", text: alt, index: idx++ });
        }
      });

      const stats = {
        links: elements.filter(e => e.type === "link").length,
        buttons: elements.filter(e => e.type === "button").length,
        inputs: elements.filter(e => e.type === "input").length,
        forms: elements.filter(e => e.type === "form").length,
        images: elements.filter(e => e.type === "image").length,
        headings: headings.length,
      };

      return {
        url, title, textSnippet: textSnippet.slice(0, 1000),
        elements: elements.slice(0, 80),
        stats, headings: headings.slice(0, 15), metaDescription: metaDesc,
      };
    });
  } catch {
    return {
      url: p.url(),
      title: "Ошибка снапшота",
      textSnippet: "",
      elements: [],
      stats: { links: 0, buttons: 0, inputs: 0, forms: 0, images: 0, headings: 0 },
      headings: [],
      metaDescription: "",
    };
  }
}

/**
 * Enhanced planner v4 — picks next action based on snapshot + goal + history + selected element
 */
function planNextAction(
  goal: string,
  snapshot: PageSnapshot,
  executedActions: string[],
  results: AgentStepResult[],
  userSelectedElement?: DOMElement | null,
): AgentAction | null {
  const lowerGoal = goal.toLowerCase();
  const done = new Set(executedActions);

  // Phase 0: If user selected an element, prioritize it
  if (userSelectedElement) {
    if (userSelectedElement.type === "link" && userSelectedElement.text && !done.has(`click_link:${userSelectedElement.text}`)) {
      return { action: "click_link", params: { text: userSelectedElement.text } };
    }
    if (userSelectedElement.type === "button" && userSelectedElement.text && !done.has(`click_button:${userSelectedElement.text}`)) {
      return { action: "click_button", params: { text: userSelectedElement.text } };
    }
    if (userSelectedElement.type === "input" && userSelectedElement.placeholder) {
      return { action: "fill_input", params: { placeholder: userSelectedElement.placeholder, value: "" } };
    }
  }

  // Phase 1: Always do dom_snapshot first
  if (!done.has("dom_snapshot")) {
    return { action: "dom_snapshot" };
  }

  // Phase 2: Goal-based action selection
  const isSummarize = /суммариз|обзор|содержим|summary/.test(lowerGoal);
  const isExplore = /ссылк|навигац|исследов|структур|explore/.test(lowerGoal);
  const isForm = /форм|обратн|контакт|form|contact/.test(lowerGoal);
  const isPlan = /план|действи|plan/.test(lowerGoal);
  const isSearch = /поиск|найти|search|find/.test(lowerGoal);

  if (snapshot.elements.length > 0) {
    if (isForm && snapshot.stats.forms > 0 && !done.has("find_buttons")) {
      return { action: "find_buttons" };
    }
    if (isSearch && snapshot.stats.inputs > 0) {
      const searchInput = snapshot.elements.find(e =>
        e.type === "input" && /search|поиск|query|q|find/i.test(e.placeholder || e.name || "")
      );
      if (searchInput && !done.has("fill_input")) {
        const searchTerm = goal.replace(/поиск|найти|search|find/gi, "").trim();
        if (searchTerm) {
          return { action: "fill_input", params: { placeholder: searchInput.placeholder || searchInput.name || "", value: searchTerm } };
        }
      }
    }
  }

  if (isForm) {
    const queue = ["find_buttons", "find_links", "extract_text", "summarize_page"];
    for (const a of queue) { if (!done.has(a)) return { action: a }; }
  }

  if (isExplore) {
    const queue = ["find_links", "find_buttons", "extract_text", "summarize_page"];
    for (const a of queue) { if (!done.has(a)) return { action: a }; }
  }

  if (isSummarize) {
    const queue = ["extract_text", "summarize_page", "find_links"];
    for (const a of queue) { if (!done.has(a)) return { action: a }; }
  }

  if (isPlan) {
    const queue = ["summarize_page", "find_links", "find_buttons", "extract_text"];
    for (const a of queue) { if (!done.has(a)) return { action: a }; }
  }

  const genericQueue = ["extract_text", "find_links", "summarize_page", "find_buttons"];
  for (const a of genericQueue) { if (!done.has(a)) return { action: a }; }

  return null;
}

/**
 * Try to get next action from model
 */
async function reasonWithModel(
  providerConfig: any,
  goal: string,
  snapshot: PageSnapshot,
  executedActions: AgentStepResult[],
  userSelectedElement?: DOMElement | null,
): Promise<AgentAction | null> {
  try {
    const elemSummary = snapshot.elements.slice(0, 20).map(e =>
      `[${e.type}] "${e.text}"${e.href ? ` → ${e.href}` : ""}${e.placeholder ? ` (placeholder: ${e.placeholder})` : ""}`
    ).join("\n");

    let selectedInfo = "";
    if (userSelectedElement) {
      selectedInfo = `\n\nПОЛЬЗОВАТЕЛЬ ВЫБРАЛ ЭЛЕМЕНТ: [${userSelectedElement.type}] "${userSelectedElement.text}"${userSelectedElement.href ? ` → ${userSelectedElement.href}` : ""}. ПРИОРИТЕТ: сначала используй этот элемент.`;
    }

    const contextStr = `
URL: ${snapshot.url}
Заголовок: ${snapshot.title}
Описание: ${snapshot.metaDescription}
Текст: ${snapshot.textSnippet.slice(0, 400)}
Элементы (${snapshot.elements.length} всего):
${elemSummary}
Статистика: ссылок=${snapshot.stats.links}, кнопок=${snapshot.stats.buttons}, полей=${snapshot.stats.inputs}, форм=${snapshot.stats.forms}
Уже выполнено: ${executedActions.map(r => r.action).join(", ")}${selectedInfo}
`.trim();

    const result = await requestPlanFromModel(providerConfig, goal, snapshot.url, contextStr);
    if (result && Array.isArray(result) && result.length > 0) {
      return result[0] as AgentAction;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Execute a single browser action
 */
export async function executeAction(
  action: AgentAction,
  safetyMode: string = "readonly"
): Promise<AgentStepResult> {
  const { action: actionName, params = {} } = action;

  if (!SAFE_ACTIONS.has(actionName)) {
    return { action: actionName, status: "blocked", detail: `Действие "${actionName}" не разрешено` };
  }

  if (safetyMode === "readonly" && CONFIRM_ACTIONS.has(actionName)) {
    return { action: actionName, status: "blocked", detail: `${actionName} заблокировано: режим «Только чтение»` };
  }

  try {
    await initBrowser();
    const p = getPage();

    switch (actionName) {
      case "navigate": {
        const url = params.url;
        if (!url) return { action: actionName, status: "error", detail: "URL не указан" };
        if (!isUrlSafe(url)) return { action: actionName, status: "blocked", detail: "URL заблокирован" };
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        const title = await p.title();
        return { action: actionName, status: "success", detail: `Открыта: ${title}`, data: { url: p.url(), title } };
      }

      case "dom_snapshot": {
        const snap = await takeSnapshot(p);
        return {
          action: actionName,
          status: "success",
          detail: `Снапшот: ${snap.elements.length} элементов (${snap.stats.links}L ${snap.stats.buttons}B ${snap.stats.inputs}I ${snap.stats.forms}F)`,
          data: { snapshot: snap },
        };
      }

      case "read_title": {
        const title = await p.title();
        return { action: actionName, status: "success", detail: `Заголовок: ${title}`, data: { title } };
      }

      case "extract_text": {
        const text = await p.evaluate(() => {
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("script, style, nav, header, footer, iframe, noscript").forEach(el => el.remove());
          return (clone.innerText || clone.textContent || "").trim().slice(0, 5000);
        });
        return { action: actionName, status: "success", detail: `Извлечено ${text.length} символов`, data: { text: text.slice(0, 3000), fullLength: text.length } };
      }

      case "find_links": {
        const links = await p.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]")).slice(0, 30).map(a => ({
            text: (a as HTMLAnchorElement).innerText?.trim().slice(0, 100) || "[без текста]",
            href: (a as HTMLAnchorElement).href,
          }))
        );
        return { action: actionName, status: "success", detail: `Найдено ${links.length} ссылок`, data: { links } };
      }

      case "find_buttons": {
        const buttons = await p.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']"));
          return btns.slice(0, 20).map(b => ({
            text: (b as HTMLElement).innerText?.trim().slice(0, 100) || (b as HTMLInputElement).value || "[без текста]",
            type: b.tagName.toLowerCase(),
          }));
        });
        return { action: actionName, status: "success", detail: `Найдено ${buttons.length} кнопок`, data: { buttons } };
      }

      case "click_link": {
        const linkText = params.text;
        if (!linkText) return { action: actionName, status: "error", detail: "Текст ссылки не указан" };
        const link = p.locator(`a:has-text("${linkText}")`).first();
        await link.click({ timeout: 5000 });
        await p.waitForLoadState("domcontentloaded");
        const newTitle = await p.title();
        return { action: actionName, status: "success", detail: `Переход: "${linkText}" → ${newTitle}`, data: { url: p.url(), title: newTitle } };
      }

      case "click_button": {
        const btnText = params.text;
        if (!btnText) return { action: actionName, status: "error", detail: "Текст кнопки не указан" };
        const btn = p.locator(`button:has-text("${btnText}"), input[type='submit'][value="${btnText}"], [role='button']:has-text("${btnText}")`).first();
        await btn.click({ timeout: 5000 });
        await p.waitForTimeout(500);
        return { action: actionName, status: "success", detail: `Нажата кнопка: "${btnText}"` };
      }

      case "fill_input": {
        const placeholder = params.placeholder;
        const value = params.value;
        if (!placeholder || !value) return { action: actionName, status: "error", detail: "Не указаны placeholder или value" };
        const input = p.locator(`input[placeholder*="${placeholder}"], textarea[placeholder*="${placeholder}"]`).first();
        await input.fill(value, { timeout: 5000 });
        return { action: actionName, status: "success", detail: `Заполнено: "${placeholder}" = "${value}"` };
      }

      case "summarize_page": {
        const pageData = await p.evaluate(() => {
          const title = document.title;
          const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
          const h1s = Array.from(document.querySelectorAll("h1")).map(h => h.innerText.trim()).slice(0, 3);
          const h2s = Array.from(document.querySelectorAll("h2")).map(h => h.innerText.trim()).slice(0, 8);
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("script, style, nav, header, footer, iframe").forEach(el => el.remove());
          const bodyText = (clone.innerText || "").trim().slice(0, 2000);
          return {
            title, metaDesc, h1s, h2s, bodyText,
            linkCount: document.querySelectorAll("a[href]").length,
            imgCount: document.querySelectorAll("img").length,
            formCount: document.querySelectorAll("form").length,
          };
        });
        return {
          action: actionName,
          status: "success",
          detail: `Суммаризация: "${pageData.title}"`,
          data: {
            title: pageData.title, description: pageData.metaDesc,
            headings: { h1: pageData.h1s, h2: pageData.h2s },
            textPreview: pageData.bodyText.slice(0, 500),
            stats: { links: pageData.linkCount, images: pageData.imgCount, forms: pageData.formCount, textLength: pageData.bodyText.length },
          },
        };
      }

      case "screenshot_description": {
        const desc = await p.evaluate(() => {
          return `Страница: ${document.title}\nURL: ${window.location.href}\nТекст: ${document.body.innerText?.slice(0, 500) || ""}`;
        });
        return { action: actionName, status: "success", detail: desc.slice(0, 500) };
      }

      default:
        return { action: actionName, status: "error", detail: `Неизвестное действие: ${actionName}` };
    }
  } catch (err: any) {
    return { action: actionName, status: "error", detail: `Ошибка: ${err.message || String(err)}` };
  }
}

/**
 * Execute a manual action from UI — wraps executeAction with preview update
 */
export async function executeManualAction(
  action: AgentAction,
  safetyMode: string = "readonly",
  sessionId: string = "default",
): Promise<AgentStepResult> {
  const result = await executeAction(action, safetyMode);
  await updatePreview(sessionId, action.action);
  return result;
}

/** Fallback plan for backward compat */
export function generateFallbackPlan(goal: string, url: string): AgentAction[] {
  const lowerGoal = goal.toLowerCase();
  const plan: AgentAction[] = [
    { action: "navigate", params: { url } },
    { action: "dom_snapshot" },
  ];
  if (/суммариз|обзор|содержим/.test(lowerGoal)) {
    plan.push({ action: "extract_text" }, { action: "summarize_page" });
  } else if (/ссылк|навигац|исследов/.test(lowerGoal)) {
    plan.push({ action: "find_links" }, { action: "extract_text" }, { action: "summarize_page" });
  } else if (/форм|обратн/.test(lowerGoal)) {
    plan.push({ action: "find_buttons" }, { action: "find_links" }, { action: "extract_text" });
  } else {
    plan.push({ action: "extract_text" }, { action: "find_links" }, { action: "summarize_page" });
  }
  return plan;
}

/**
 * Main agentic loop v5: session-aware, with step snapshot recording
 */
export async function runAgentLoop(config: AgentRunConfig): Promise<{
  results: AgentStepResult[];
  snapshots: PageSnapshot[];
  planSource: string;
  degraded?: boolean;
  degradedReason?: string;
}> {
  const { url, goal, taskId, sessionId, safetyMode, maxSteps, providerConfig } = config;

  // Guard: if the browser is already running a task, return a degraded response
  // rather than corrupting the shared browser state.
  if (browserLocked) {
    const degradedMsg = "Браузер занят другой задачей — degraded режим (только евристический план, без выполнения)";
    emit(taskId, sessionId, { type: "warning", step: 0, detail: degradedMsg, timestamp: new Date().toISOString() });
    const fallbackPlan = generateFallbackPlan(goal, url);
    return {
      results: [{ action: "degraded", status: "warning", detail: degradedMsg }],
      snapshots: [],
      planSource: "heuristic",
      degraded: true,
      degradedReason: degradedMsg,
    };
  }

  const results: AgentStepResult[] = [];
  const snapshots: PageSnapshot[] = [];
  const executedActions: string[] = [];
  let planSource = "heuristic";
  let currentStep = 0;
  let lastSnapshot: PageSnapshot | null = null;

  browserLocked = true;
  try {
  await initBrowser();
  const p = getPage();

  // ── Step 0: Navigate ──
  emit(taskId, sessionId, { type: "action", step: 0, maxSteps, phase: "navigate", detail: `Открываю ${url}`, timestamp: new Date().toISOString() });

  const navResult = await executeAction({ action: "navigate", params: { url } }, safetyMode);
  results.push(navResult);
  executedActions.push("navigate");
  currentStep++;

  emit(taskId, sessionId, { type: "action_result", step: 0, phase: "navigate", detail: navResult.detail, data: { status: navResult.status }, timestamp: new Date().toISOString() });

  // Update preview and record step snapshot
  const navScreenshot = await updatePreview(sessionId, "navigate");
  
  // Record step snapshot for replay
  await storage.addStepSnapshot({
    taskId,
    sessionId,
    stepIndex: 0,
    phase: "navigate",
    action: "navigate",
    status: navResult.status,
    detail: navResult.detail,
    timestamp: new Date().toISOString(),
    screenshotBase64: navScreenshot || null,
    snapshotJson: null,
  });

  if (navResult.status === "error") {
    emit(taskId, sessionId, { type: "error", step: 0, detail: `Не удалось открыть: ${navResult.detail}`, timestamp: new Date().toISOString() });
    emit(taskId, sessionId, { type: "completed", step: 0, detail: "Задача завершена с ошибкой навигации", data: { success: false }, timestamp: new Date().toISOString() });
    return { results, snapshots, planSource };
  }

  // ── Agentic loop ──
  while (currentStep < maxSteps) {
    // 1) SNAPSHOT
    emit(taskId, sessionId, { type: "observation", step: currentStep, maxSteps, phase: "observe", detail: "Сканирую DOM страницы...", timestamp: new Date().toISOString() });

    lastSnapshot = await takeSnapshot(p);
    snapshots.push(lastSnapshot);

    const session = getOrCreateSession(sessionId);
    session.lastSnapshot = lastSnapshot;

    emit(taskId, sessionId, {
      type: "observation", step: currentStep, maxSteps, phase: "observe",
      detail: `${lastSnapshot.title} | ${lastSnapshot.elements.length} элементов (${lastSnapshot.stats.links}L ${lastSnapshot.stats.buttons}B ${lastSnapshot.stats.inputs}I ${lastSnapshot.stats.forms}F)`,
      data: { snapshot: lastSnapshot },
      timestamp: new Date().toISOString(),
    });

    emit(taskId, sessionId, { type: "step_counter", step: currentStep, maxSteps, detail: `Шаг ${currentStep}/${maxSteps}`, timestamp: new Date().toISOString() });

    // 2) REASON
    emit(taskId, sessionId, { type: "reasoning", step: currentStep, maxSteps, phase: "reason", detail: "Выбираю следующее действие...", timestamp: new Date().toISOString() });

    let nextAction: AgentAction | null = null;
    const currentSelectedElement = session.selectedElement;

    if (providerConfig?.model && lastSnapshot) {
      nextAction = await reasonWithModel(providerConfig, goal, lastSnapshot, results, currentSelectedElement);
      if (nextAction) planSource = "model";
    }

    if (!nextAction && lastSnapshot) {
      nextAction = planNextAction(goal, lastSnapshot, executedActions, results, currentSelectedElement);
      if (nextAction && planSource !== "model") planSource = "heuristic";
    }

    if (currentSelectedElement && nextAction) {
      session.selectedElement = null;
    }

    if (!nextAction) {
      emit(taskId, sessionId, { type: "reasoning", step: currentStep, maxSteps, phase: "reason", detail: "Все действия выполнены. Завершаю.", timestamp: new Date().toISOString() });
      break;
    }

    emit(taskId, sessionId, {
      type: "reasoning", step: currentStep, maxSteps, phase: "reason",
      detail: `→ ${nextAction.action}${nextAction.params ? " " + JSON.stringify(nextAction.params) : ""}`,
      data: { nextAction },
      timestamp: new Date().toISOString(),
    });

    // 3) CONFIRM if needed
    if (safetyMode === "confirm" && CONFIRM_ACTIONS.has(nextAction.action)) {
      const approved = await waitForConfirmation(taskId, sessionId, currentStep, nextAction, lastSnapshot);
      
      // Restore running status after confirmation
      await storage.updateTaskStatus(taskId, "running");
      
      emit(taskId, sessionId, { type: "confirm_response", step: currentStep, detail: approved ? "Подтверждено" : "Отклонено", data: { approved }, timestamp: new Date().toISOString() });
      if (!approved) {
        results.push({ action: nextAction.action, status: "skipped", detail: `Отклонено пользователем` });
        await storage.addLog({ taskId, sessionId, stepIndex: currentStep, action: nextAction.action, detail: "Отклонено", status: "warning", timestamp: new Date().toISOString() });
        executedActions.push(nextAction.action);
        currentStep++;
        continue;
      }
    }

    // 4) ACT
    emit(taskId, sessionId, { type: "action", step: currentStep, maxSteps, phase: "act", detail: `Выполняю: ${nextAction.action}`, data: { action: nextAction }, timestamp: new Date().toISOString() });

    const result = await executeAction(nextAction, safetyMode);
    results.push(result);
    executedActions.push(nextAction.action);

    emit(taskId, sessionId, {
      type: "action_result", step: currentStep, maxSteps, phase: "act",
      detail: result.detail,
      data: { status: result.status, resultData: result.data },
      timestamp: new Date().toISOString(),
    });

    await storage.addLog({
      taskId, sessionId, stepIndex: currentStep, action: result.action, detail: result.detail,
      status: result.status === "blocked" || result.status === "skipped" ? "warning" : result.status,
      timestamp: new Date().toISOString(),
    });

    // 5) UPDATE PREVIEW and record step snapshot
    const stepScreenshot = await updatePreview(sessionId, nextAction.action);
    
    // Record step snapshot for replay
    const snapshotJson = lastSnapshot ? JSON.stringify({
      url: lastSnapshot.url,
      title: lastSnapshot.title,
      stats: lastSnapshot.stats,
      headings: lastSnapshot.headings,
    }) : null;

    await storage.addStepSnapshot({
      taskId,
      sessionId,
      stepIndex: currentStep,
      phase: result.action,
      action: nextAction.action,
      status: result.status,
      detail: result.detail,
      timestamp: new Date().toISOString(),
      screenshotBase64: stepScreenshot || null,
      snapshotJson,
    });

    if (result.status === "error") {
      emit(taskId, sessionId, { type: "warning", step: currentStep, detail: `${nextAction.action} не удалось, ищу альтернативу...`, timestamp: new Date().toISOString() });
      if (lastSnapshot && lastSnapshot.elements.length > 0) {
        const altAction = findAlternativeAction(nextAction, lastSnapshot, executedActions);
        if (altAction) {
          emit(taskId, sessionId, { type: "reasoning", step: currentStep, phase: "reason", detail: `Альтернатива: ${altAction.action}`, data: { nextAction: altAction }, timestamp: new Date().toISOString() });
        }
      }
    }

    currentStep++;
  }

  if (currentStep >= maxSteps) {
    emit(taskId, sessionId, { type: "warning", step: currentStep, maxSteps, detail: `Лимит шагов (${maxSteps}) достигнут`, timestamp: new Date().toISOString() });
  }

  // Final preview update
  await updatePreview(sessionId, "completed");

  const hasErrors = results.some(r => r.status === "error");
  emit(taskId, sessionId, {
    type: "completed", step: currentStep, maxSteps,
    detail: hasErrors ? "Задача завершена с ошибками" : "Задача выполнена успешно",
    data: { success: !hasErrors, totalSteps: currentStep, planSource },
    timestamp: new Date().toISOString(),
  });

  return { results, snapshots, planSource };
  } finally {
    browserLocked = false;
  }
}

/**
 * Enhanced replanner — find alternative action when current one fails
 */
function findAlternativeAction(
  failedAction: AgentAction,
  snapshot: PageSnapshot,
  executedActions: string[],
): AgentAction | null {
  const done = new Set(executedActions);

  if (failedAction.action === "click_link") {
    const targetText = failedAction.params?.text?.toLowerCase() || "";
    const altLink = snapshot.elements.find(e =>
      e.type === "link" && e.text.toLowerCase().includes(targetText.slice(0, 5)) && !done.has(`click_link:${e.text}`)
    );
    if (altLink) {
      return { action: "click_link", params: { text: altLink.text } };
    }
  }

  if (failedAction.action === "click_button") {
    const altBtn = snapshot.elements.find(e =>
      e.type === "button" && !done.has(`click_button:${e.text}`)
    );
    if (altBtn) {
      return { action: "click_button", params: { text: altBtn.text } };
    }
  }

  if (failedAction.action === "fill_input") {
    const altInput = snapshot.elements.find(e =>
      e.type === "input" && e.placeholder !== failedAction.params?.placeholder
    );
    if (altInput) {
      return { action: "fill_input", params: { placeholder: altInput.placeholder || altInput.name || "", value: failedAction.params?.value || "" } };
    }
  }

  return null;
}
