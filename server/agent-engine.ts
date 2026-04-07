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
  /** Execution params. _key is an internal deduplication hint — never passed to browser. */
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

/**
 * Chromium availability probe.
 * Tries to resolve the Chromium executable path via Playwright's registry.
 * Does NOT launch the browser — pure filesystem check.
 * Result is cached after the first call so subsequent checks are O(1).
 */
let _chromiumAvailable: boolean | null = null;

export async function probeChromiumAvailable(): Promise<boolean> {
  if (_chromiumAvailable !== null) return _chromiumAvailable;
  try {
    const { chromium: pw } = await import("playwright");
    const execPath = pw.executablePath();
    const fs = await import("fs/promises");
    await fs.access(execPath);
    _chromiumAvailable = true;
  } catch {
    _chromiumAvailable = false;
  }
  return _chromiumAvailable;
}

/** Reset the cached chromium probe result (used in tests) */
export function resetChromiumProbe(): void {
  _chromiumAvailable = null;
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

// ─── Consent / Cookie / GDPR Interstitial Handling ──────────────────────────

/**
 * Detect consent/cookie/GDPR interstitial pages.
 * Covers Google consent.google.com, google.com consent flow, and similar patterns.
 */
export function isConsentPage(urlOrSnapshot: string | PageSnapshot): boolean {
  const url = typeof urlOrSnapshot === "string" ? urlOrSnapshot : urlOrSnapshot.url;
  const text = typeof urlOrSnapshot === "string" ? "" : (urlOrSnapshot.textSnippet || "");
  const title = typeof urlOrSnapshot === "string" ? "" : (urlOrSnapshot.title || "");

  // URL-based detection (most reliable)
  if (
    /consent\.google\.com/i.test(url) ||
    /\/sorry\//i.test(url) ||
    /google\.com.*consent/i.test(url) ||
    /accounts\.google\.com.*consent/i.test(url)
  ) {
    return true;
  }

  // Text/title based detection for cases where URL doesn't give it away
  const combined = (title + " " + text).toLowerCase();
  if (
    /before you continue to google/i.test(combined) ||
    /before you continue/i.test(combined) && /google/i.test(combined) ||
    /we use cookies/i.test(combined) && /google/i.test(combined) ||
    /прежде чем перейти в google/i.test(combined) ||
    /прежде чем перейти/i.test(combined) && /google/i.test(combined) ||
    /cookie.*consent/i.test(combined) ||
    /ваши настройки конфиденциальности/i.test(combined) ||
    /privacy settings.*google/i.test(combined) ||
    /accept.*cookies/i.test(combined) && /google/i.test(url)
  ) {
    return true;
  }

  return false;
}

/**
 * Attempt to handle consent/interstitial page.
 * v2: iframe-aware, scroll+visible detection, fallback elementHandle click,
 *     per-strategy anti-loop tracking (same strategy not retried on same URL).
 *
 * Strategies attempted in order:
 *   S1. Known CSS selectors — main frame + all child frames
 *   S2. Button text search — main frame + all child frames, with scroll
 *   S3. JavaScript DOM walk — main frame + all child frames
 *   S4. Direct navigation bypass via continue/redirect param
 *
 * Returns a result describing what happened. Does NOT fake success.
 */

/**
 * Per-URL strategy attempt tracker — prevents the same strategy from being
 * re-tried on the same consent URL when handleConsentPage is called multiple
 * times in the same session (anti-loop hardening).
 * Key: urlPrefix (first 80 chars) → Set of tried strategy IDs.
 */
const _consentStrategyAttempts = new Map<string, Set<string>>();

function _consentUrlKey(url: string): string {
  return url.slice(0, 80);
}

function _consentStrategyTried(url: string, strategyId: string): boolean {
  const key = _consentUrlKey(url);
  const tried = _consentStrategyAttempts.get(key);
  return tried ? tried.has(strategyId) : false;
}

function _consentStrategyMark(url: string, strategyId: string): void {
  const key = _consentUrlKey(url);
  if (!_consentStrategyAttempts.has(key)) {
    _consentStrategyAttempts.set(key, new Set());
  }
  _consentStrategyAttempts.get(key)!.add(strategyId);
}

/** Reset consent strategy tracking (e.g. after a successful navigation away). */
export function resetConsentStrategyTracking(): void {
  _consentStrategyAttempts.clear();
}

/**
 * Attempt to click a Playwright locator with fallback strategies:
 * 1. Scroll into view + standard locator.click()
 * 2. elementHandle.click() (bypasses some iframe/overlay issues)
 * 3. elementHandle.dispatchEvent('click') (last resort)
 */
async function robustClick(
  frameOrPage: import("playwright").Page | import("playwright").Frame,
  selector: string,
  timeout = 5000
): Promise<boolean> {
  try {
    const loc = frameOrPage.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (count === 0) return false;

    // Scroll into view first
    try {
      const handle = await loc.elementHandle({ timeout: 2000 });
      if (handle) {
        await handle.evaluate((el: Element) => {
          (el as HTMLElement).scrollIntoView({ behavior: "instant", block: "center" });
        });
        await new Promise(r => setTimeout(r, 300));
      }
    } catch { /* scroll failed — proceed anyway */ }

    const visible = await loc.isVisible().catch(() => false);
    if (!visible) return false;

    // Attempt 1: standard locator click
    try {
      await loc.click({ timeout });
      return true;
    } catch { /* fall through */ }

    // Attempt 2: elementHandle click (bypasses some overlay interceptions)
    try {
      const handle = await loc.elementHandle({ timeout: 2000 });
      if (handle) {
        await handle.click();
        return true;
      }
    } catch { /* fall through */ }

    // Attempt 3: JS dispatchEvent click (last resort — works even when element
    // is inside a shadow DOM or partially obscured)
    try {
      const handle = await loc.elementHandle({ timeout: 2000 });
      if (handle) {
        await handle.evaluate((el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
        return true;
      }
    } catch { /* fall through */ }

    return false;
  } catch {
    return false;
  }
}

export async function handleConsentPage(p: Page): Promise<AgentStepResult> {
  const currentUrl = p.url();

  // Collect all frames: main page + all child frames
  const allFrames: Array<Page | import("playwright").Frame> = [p, ...p.frames().filter(f => f !== p.mainFrame())];

  // ── Strategy 1: Known CSS selectors ────────────────────────────────────────
  const S1 = "s1_known_selectors";
  if (!_consentStrategyTried(currentUrl, S1)) {
    _consentStrategyMark(currentUrl, S1);

    const knownSelectors = [
      // Consent.google.com — primary buttons
      'form[action*="consent"] button',
      'button[jsname="b3VHJd"]',
      'button[jsname="higCR"]',
      'div[jsname="higCR"]',
      '#introAgreeButton',
      'button.tHlp8d',
      'div.VfPpkd-RLmnJb',
      '[aria-label="Accept all"]',
      '[aria-label="Alle akzeptieren"]',
      '[aria-label="Tout accepter"]',
      '[aria-label="Aceptar todo"]',
      '[aria-label="Принять все"]',
      '[aria-label="Принять всё"]',
      '[aria-label="Kabul et"]',
      '[aria-label="Accetta tutto"]',
    ];

    for (const frame of allFrames) {
      // Scroll to bottom of this frame to expose lazy-rendered buttons
      try {
        await (frame as any).evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 300));
      } catch { /* ignore */ }

      for (const sel of knownSelectors) {
        try {
          const clicked = await robustClick(frame as any, sel, 5000);
          if (clicked) {
            await p.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
            const newUrl = p.url();
            if (!isConsentPage(newUrl)) {
              resetConsentStrategyTracking();
              return { action: "handle_consent", status: "success", detail: `Consent принят (selector: ${sel}${frame !== p ? " [iframe]" : ""}), перешли на ${newUrl}` };
            }
          }
        } catch { /* try next */ }
      }
    }
  }

  // ── Strategy 2: Button text search ─────────────────────────────────────────
  const S2 = "s2_button_text";
  if (!_consentStrategyTried(currentUrl, S2)) {
    _consentStrategyMark(currentUrl, S2);

    const consentButtonTexts = [
      "Accept all", "Accept All", "I agree", "Agree", "Accept",
      "OK", "Принять всё", "Принять все", "Принять", "Согласен",
      "Согласиться", "Я согласен", "Alle akzeptieren", "Akzeptieren",
      "Tout accepter", "Accepter tout", "Aceptar todo", "Acceptar",
      "Accetta tutto", "Accetto", "Kabul et", "Kabul Et",
      "Zezwól na wszystkie", "Alle cookies accepteren",
    ];

    for (const frame of allFrames) {
      // Scroll down to expose buttons that might be below the fold
      try {
        await (frame as any).evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 300));
      } catch { /* ignore */ }

      for (const btnText of consentButtonTexts) {
        const sel = `button:has-text("${btnText}"), input[type="submit"][value="${btnText}"], [role="button"]:has-text("${btnText}")`;
        try {
          const clicked = await robustClick(frame as any, sel, 5000);
          if (clicked) {
            await p.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
            const newUrl = p.url();
            if (!isConsentPage(newUrl)) {
              resetConsentStrategyTracking();
              return { action: "handle_consent", status: "success", detail: `Consent принят (кнопка: "${btnText}"${frame !== p ? " [iframe]" : ""}), перешли на ${newUrl}` };
            }
          }
        } catch { /* try next */ }
      }
    }
  }

  // ── Strategy 3: JavaScript DOM walk ────────────────────────────────────────
  const S3 = "s3_js_dom_walk";
  if (!_consentStrategyTried(currentUrl, S3)) {
    _consentStrategyMark(currentUrl, S3);

    for (const frame of allFrames) {
      try {
        const clicked = await (frame as any).evaluate(() => {
          const acceptKeywords = [
            "accept", "agree", "принять", "согласен", "akzeptieren",
            "accepter", "aceptar", "accetta", "kabul", "ok",
          ];
          const rejectKeywords = ["reject", "decline", "отказ", "ablehnen", "refuser", "rifiuta", "не принимать"];

          // Scroll to expose all content
          window.scrollTo(0, document.body.scrollHeight);

          const allButtons = Array.from(
            document.querySelectorAll("button, [role='button'], input[type='submit'], a[href='#']")
          ) as HTMLElement[];

          for (const btn of allButtons) {
            const text = (btn.textContent || (btn as HTMLInputElement).value || "").toLowerCase().trim();
            const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
            const combined = text + " " + ariaLabel;

            if (!acceptKeywords.some(kw => combined.includes(kw))) continue;
            if (rejectKeywords.some(kw => combined.includes(kw))) continue;

            const style = window.getComputedStyle(btn);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;

            const rect = btn.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            btn.scrollIntoView({ behavior: "instant", block: "center" });
            btn.click();
            btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            return text || ariaLabel || "button";
          }
          return null;
        });

        if (clicked) {
          await p.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
          const newUrl = p.url();
          if (!isConsentPage(newUrl)) {
            resetConsentStrategyTracking();
            return { action: "handle_consent", status: "success", detail: `Consent принят (JS walk: "${clicked}"${frame !== p ? " [iframe]" : ""}), перешли на ${newUrl}` };
          }
        }
      } catch { /* JS eval failed — try next frame */ }
    }
  }

  // ── Strategy 4: Direct navigation bypass ───────────────────────────────────
  const S4 = "s4_direct_nav";
  if (!_consentStrategyTried(currentUrl, S4)) {
    _consentStrategyMark(currentUrl, S4);

    try {
      const continueUrl = await p.evaluate(() => {
        const continueInput = document.querySelector('input[name="continue"], input[name="redirect"]') as HTMLInputElement | null;
        if (continueInput?.value) return continueInput.value;
        const params = new URLSearchParams(window.location.search);
        return params.get("continue") || params.get("redirect") || null;
      }).catch(() => null);

      if (continueUrl && isUrlSafe(continueUrl)) {
        await p.goto(continueUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        const newUrl = p.url();
        if (!isConsentPage(newUrl)) {
          resetConsentStrategyTracking();
          return { action: "handle_consent", status: "success", detail: `Consent обойдён (прямая навигация), перешли на ${newUrl}` };
        }
      }
    } catch { /* continue URL extraction failed */ }
  }

  // All strategies exhausted (or already tried) — return precise failure
  const triedStrategies = Array.from(_consentStrategyAttempts.get(_consentUrlKey(currentUrl)) || []).join(", ");
  return {
    action: "handle_consent",
    status: "error",
    detail: `Не удалось обработать consent-страницу (${currentUrl}). Попытки: [${triedStrategies}]. Все ${allFrames.length} frame(s) проверены. Задача требует ручного вмешательства или другого URL.`,
  };
}


// ─── Anti-loop protection ──────────────────────────────────────────────────────

/**
 * Track recently failed actions to detect infinite retry loops.
 * Key: "action:param_hash:url_hash" → failure count
 */
function makeLoopKey(action: string, params: Record<string, string> | undefined, url: string): string {
  const paramStr = params
    ? Object.entries(params)
        .filter(([k]) => k !== "_key")
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join(",")
    : "";
  // Use first 30 chars of URL to group by page without being too specific
  const urlShort = url.slice(0, 50);
  return `${action}|${paramStr}|${urlShort}`;
}

// ─── Site-specific heuristics ─────────────────────────────────────────────────

/**
 * Detect search-intent and extract query term from goal.
 * Returns null if no search term found.
 */
function extractSearchQuery(goal: string): string | null {
  const raw = goal.trim();
  // Pattern: "Найти: X" or "Поиск: X" or "Search: X" (colon separator — produced by resolveComputerQuery)
  const mColon = raw.match(/^(?:найти|найди|поиск|search|find):\s*(.+)/i);
  if (mColon) return mColon[1].trim();
  // Patterns with "in google": "Поиск в Google: X"
  const mInSite = raw.match(/(?:поиск|search)\s+в\s+\S+:\s*(.+)/i);
  if (mInSite) return mInSite[1].trim();
  // Patterns: "найди X", "поиск X", "search X", "find X", "загугли X", "погугли X"
  const m = raw.match(/^(?:найди|найти|поиск|ищи|искать|search\s+for|search|find|загугли|погугли)\s+(.+)/i);
  if (m) return m[1].trim();
  return null;
}

/**
 * Google homepage heuristic:
 * If we're on google.com and goal contains a search term, fill the search box.
 */
function googleHeuristic(
  goal: string,
  snapshot: PageSnapshot,
  doneKeys: Set<string>,
): AgentAction | null {
  if (!/google\.com/.test(snapshot.url)) return null;
  // Already on search results page — nothing more needed from Google's side
  if (/google\.com\/search/.test(snapshot.url)) return null;

  const searchQuery = extractSearchQuery(goal);
  if (!searchQuery) return null;

  // Find search input — Google uses name="q" or aria-label / placeholder variants
  const searchInput = snapshot.elements.find(e =>
    e.type === "input" && (/search|поиск|query/i.test(e.placeholder || "") || /^q$/i.test(e.name || ""))
  );
  if (!searchInput) return null;

  const fillKey = `fill_input:q:${searchQuery}`;
  if (!doneKeys.has(fillKey)) {
    return { action: "fill_input", params: { placeholder: searchInput.placeholder || "Поиск", value: searchQuery, _key: fillKey } };
  }

  // After fill, click Search button
  const submitKey = `click_button:Google Search`;
  if (!doneKeys.has(submitKey)) {
    const searchBtn = snapshot.elements.find(e =>
      e.type === "button" && /Google Search|Поиск|Найти/i.test(e.text)
    );
    if (searchBtn) {
      return { action: "click_button", params: { text: searchBtn.text, _key: submitKey } };
    }
    // Fallback: press Enter via navigate to search URL
    const navigateKey = `navigate:google_search:${searchQuery}`;
    if (!doneKeys.has(navigateKey)) {
      return {
        action: "navigate",
        params: { url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`, _key: navigateKey },
      };
    }
  }

  return null;
}

/**
 * YouTube homepage heuristic:
 * If goal has search intent and we're on youtube.com home, fill the search bar.
 */
function youtubeHeuristic(
  goal: string,
  snapshot: PageSnapshot,
  doneKeys: Set<string>,
): AgentAction | null {
  if (!/youtube\.com(?!\/results)/.test(snapshot.url)) return null;
  if (/youtube\.com\/results/.test(snapshot.url)) return null;

  const searchQuery = extractSearchQuery(goal);
  if (!searchQuery) return null;

  const fillKey = `fill_input:youtube:${searchQuery}`;
  if (!doneKeys.has(fillKey)) {
    const searchInput = snapshot.elements.find(e =>
      e.type === "input" && /search|поиск|query/i.test(e.placeholder || e.name || "")
    );
    if (searchInput) {
      return { action: "fill_input", params: { placeholder: searchInput.placeholder || "Search", value: searchQuery, _key: fillKey } };
    }
    // Fallback: direct URL
    const navKey = `navigate:youtube_search:${searchQuery}`;
    if (!doneKeys.has(navKey)) {
      return {
        action: "navigate",
        params: { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`, _key: navKey },
      };
    }
  }
  return null;
}

/**
 * GitHub heuristic:
 * If goal has search intent and we're on github.com home, fill the search bar or navigate directly.
 */
function githubHeuristic(
  goal: string,
  snapshot: PageSnapshot,
  doneKeys: Set<string>,
): AgentAction | null {
  if (!/github\.com/.test(snapshot.url)) return null;
  if (/github\.com\/search/.test(snapshot.url)) return null;

  const searchQuery = extractSearchQuery(goal);
  if (!searchQuery) return null;

  const navKey = `navigate:github_search:${searchQuery}`;
  if (!doneKeys.has(navKey)) {
    return {
      action: "navigate",
      params: { url: `https://github.com/search?q=${encodeURIComponent(searchQuery)}&type=repositories`, _key: navKey },
    };
  }
  return null;
}

/**
 * Wikipedia heuristic:
 * If goal has a topic and we're on Wikipedia main page, search directly.
 */
function wikipediaHeuristic(
  goal: string,
  snapshot: PageSnapshot,
  doneKeys: Set<string>,
): AgentAction | null {
  if (!/wikipedia\.org/.test(snapshot.url)) return null;
  // Already on article page
  if (/\/wiki\//.test(snapshot.url) && !/Special:Search/.test(snapshot.url)) return null;

  const searchQuery = extractSearchQuery(goal) || goal.replace(/открой|открыть|найди|поиск|search|find/gi, "").trim();
  if (!searchQuery || searchQuery.length < 3) return null;

  const navKey = `navigate:wikipedia_search:${searchQuery}`;
  if (!doneKeys.has(navKey)) {
    return {
      action: "navigate",
      params: { url: `https://ru.wikipedia.org/w/index.php?search=${encodeURIComponent(searchQuery)}`, _key: navKey },
    };
  }
  return null;
}

/**
 * After-search heuristic:
 * When we're on a search results page, extract_text and summarize.
 */
function afterSearchHeuristic(
  snapshot: PageSnapshot,
  doneKeys: Set<string>,
): AgentAction | null {
  const isResultsPage = (
    /google\.com\/search/.test(snapshot.url) ||
    /youtube\.com\/results/.test(snapshot.url) ||
    /github\.com\/search/.test(snapshot.url) ||
    /wikipedia\.org.*search/.test(snapshot.url) ||
    /yandex\.ru\/search/.test(snapshot.url) ||
    /stackoverflow\.com\/search/.test(snapshot.url)
  );
  if (!isResultsPage) return null;

  if (!doneKeys.has("extract_text")) return { action: "extract_text" };
  if (!doneKeys.has("find_links")) return { action: "find_links" };
  if (!doneKeys.has("summarize_page")) return { action: "summarize_page" };
  return null;
}

/**
 * Enhanced planner v5 — picks next action based on snapshot + goal + history + selected element
 * Key changes:
 *  - doneKeys tracks action+params to avoid false-deduplication (fill_input can fire for different queries)
 *  - Site-specific heuristics for Google, YouTube, GitHub, Wikipedia
 *  - After-navigation continuation: never stops at just opening a page if goal implies next step
 */
/**
 * Check if an action has been blocked by anti-loop protection on the current page.
 * Anti-loop sentinels are stored as "anti_loop:action:urlPrefix" in executedActions.
 */
function isBlockedByAntiLoop(action: string, url: string, doneKeys: Set<string>): boolean {
  const urlShort = url.slice(0, 50);
  return doneKeys.has(`anti_loop:${action}:${urlShort}`);
}

function planNextAction(
  goal: string,
  snapshot: PageSnapshot,
  executedActions: string[],
  results: AgentStepResult[],
  userSelectedElement?: DOMElement | null,
): AgentAction | null {
  const lowerGoal = goal.toLowerCase();
  // Use compound keys: action:param for deduplication so fill_input can fire multiple times
  // with different queries, but not the same query twice.
  const doneKeys = new Set(executedActions);

  // Phase 0: If user selected an element, prioritize it
  if (userSelectedElement) {
    const selKey = `${userSelectedElement.type === "link" ? "click_link" : userSelectedElement.type === "button" ? "click_button" : "fill_input"}:user_selected:${userSelectedElement.text}`;
    if (!doneKeys.has(selKey)) {
      if (userSelectedElement.type === "link" && userSelectedElement.text) {
        return { action: "click_link", params: { text: userSelectedElement.text, _key: selKey } };
      }
      if (userSelectedElement.type === "button" && userSelectedElement.text) {
        return { action: "click_button", params: { text: userSelectedElement.text, _key: selKey } };
      }
      if (userSelectedElement.type === "input" && userSelectedElement.placeholder) {
        return { action: "fill_input", params: { placeholder: userSelectedElement.placeholder, value: "", _key: selKey } };
      }
    }
  }

  // Phase 1: Always do dom_snapshot first
  if (!doneKeys.has("dom_snapshot")) {
    return { action: "dom_snapshot" };
  }

  // Phase 2: Site-specific heuristics — run BEFORE generic logic so popular sites work well
  // Skip any site action whose action type has been blocked by anti-loop protection on this page.
  const rawSiteAction = (
    googleHeuristic(goal, snapshot, doneKeys) ||
    youtubeHeuristic(goal, snapshot, doneKeys) ||
    githubHeuristic(goal, snapshot, doneKeys) ||
    wikipediaHeuristic(goal, snapshot, doneKeys) ||
    afterSearchHeuristic(snapshot, doneKeys)
  );
  if (rawSiteAction && !isBlockedByAntiLoop(rawSiteAction.action, snapshot.url, doneKeys)) {
    return rawSiteAction;
  }

  // Phase 3: Goal-based action selection
  const isSummarize = /суммариз|обзор|содержим|summary/.test(lowerGoal);
  const isExplore = /ссылк|навигац|исследов|структур|explore/.test(lowerGoal);
  const isForm = /форм|обратн|контакт|form|contact/.test(lowerGoal);
  const isPlan = /план|действи|plan/.test(lowerGoal);
  const isSearch = /поиск|найти|search|find|загугли|погугли/.test(lowerGoal);

  if (snapshot.elements.length > 0) {
    if (isForm && snapshot.stats.forms > 0 && !doneKeys.has("find_buttons")) {
      return { action: "find_buttons" };
    }
    if (isSearch && snapshot.stats.inputs > 0 && !isBlockedByAntiLoop("fill_input", snapshot.url, doneKeys)) {
      const searchInput = snapshot.elements.find(e =>
        e.type === "input" && /search|поиск|query|q|find/i.test(e.placeholder || e.name || "")
      );
      if (searchInput) {
        const searchTerm = extractSearchQuery(goal) || goal.replace(/поиск|найти|search|find|загугли|погугли/gi, "").trim();
        const fillKey = `fill_input:generic:${searchTerm}`;
        if (searchTerm && !doneKeys.has(fillKey)) {
          return { action: "fill_input", params: { placeholder: searchInput.placeholder || searchInput.name || "", value: searchTerm, _key: fillKey } };
        }
      }
    }
  }

  if (isForm) {
    const queue = ["find_buttons", "find_links", "extract_text", "summarize_page"];
    for (const a of queue) { if (!doneKeys.has(a)) return { action: a }; }
  }

  if (isExplore) {
    const queue = ["find_links", "find_buttons", "extract_text", "summarize_page"];
    for (const a of queue) { if (!doneKeys.has(a)) return { action: a }; }
  }

  if (isSummarize) {
    const queue = ["extract_text", "summarize_page", "find_links"];
    for (const a of queue) { if (!doneKeys.has(a)) return { action: a }; }
  }

  if (isPlan) {
    const queue = ["summarize_page", "find_links", "find_buttons", "extract_text"];
    for (const a of queue) { if (!doneKeys.has(a)) return { action: a }; }
  }

  const genericQueue = ["extract_text", "find_links", "summarize_page", "find_buttons"];
  for (const a of genericQueue) { if (!doneKeys.has(a)) return { action: a }; }

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
  const { action: actionName } = action;
  // Strip internal _key param — it's used only for deduplication tracking, not for browser ops
  const params = action.params ? Object.fromEntries(Object.entries(action.params).filter(([k]) => k !== "_key")) : {};

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
        if (value === undefined || value === null) return { action: actionName, status: "error", detail: "Не указано value" };
        // Build a rich locator that tries multiple strategies:
        // 1. By placeholder attribute (partial match)
        // 2. By name="q" (Google-style)
        // 3. Any visible search input
        let input = placeholder
          ? p.locator(`input[placeholder*="${placeholder}"], textarea[placeholder*="${placeholder}"]`).first()
          : p.locator(`input[type="text"], input[type="search"], textarea`).first();

        // If placeholder-based locator isn't found, try name="q" fallback (Google)
        let filled = false;
        try {
          await input.waitFor({ state: "visible", timeout: 3000 });
          await input.fill(value, { timeout: 5000 });
          filled = true;
        } catch {
          // Fallback: try input[name="q"] (Google search)
          try {
            const fallback = p.locator(`input[name="q"], input[type="search"]`).first();
            await fallback.waitFor({ state: "visible", timeout: 3000 });
            await fallback.fill(value, { timeout: 5000 });
            // Also press Enter to submit
            await fallback.press("Enter");
            await p.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
            filled = true;
            return { action: actionName, status: "success", detail: `Заполнено и отправлено (fallback): "${value}"` };
          } catch (e2: any) {
            return { action: actionName, status: "error", detail: `Не удалось заполнить поле: ${e2.message || String(e2)}` };
          }
        }
        if (filled) {
          // Press Enter after fill for search inputs
          try {
            await input.press("Enter");
            await p.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
          } catch { /* non-critical */ }
          return { action: actionName, status: "success", detail: `Заполнено: "${placeholder || 'input'}" = "${value}"` };
        }
        return { action: actionName, status: "error", detail: `Поле не найдено` };
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
  // Search goals: fill search input, then extract results
  if (/найти|\bsearch\b|find|\bпоиск\b|загугли|погугли/.test(lowerGoal)) {
    const searchQuery = extractSearchQuery(goal);
    if (searchQuery) {
      plan.push(
        { action: "fill_input", params: { placeholder: "Поиск", value: searchQuery } },
        { action: "extract_text" },
        { action: "find_links" },
        { action: "summarize_page" }
      );
    } else {
      plan.push({ action: "extract_text" }, { action: "find_links" }, { action: "summarize_page" });
    }
  } else if (/суммариз|обзор|содержим/.test(lowerGoal)) {
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

  // ── Pre-loop: Consent / GDPR interstitial check ──
  // Handle consent pages immediately after navigation, before the main loop.
  // This prevents the agent from entering the loop while stuck on a consent page.
  {
    const consentCheckUrl = p.url();
    const consentInitialSnapshot = await takeSnapshot(p);
    if (isConsentPage(consentInitialSnapshot) || isConsentPage(consentCheckUrl)) {
      emit(taskId, sessionId, {
        type: "action", step: currentStep, maxSteps, phase: "consent",
        detail: `Consent/cookie страница обнаружена (${consentCheckUrl}) — пытаюсь обработать...`,
        timestamp: new Date().toISOString(),
      });
      const consentResult = await handleConsentPage(p);
      results.push(consentResult);
      executedActions.push("handle_consent");
      currentStep++;
      emit(taskId, sessionId, {
        type: "action_result", step: currentStep, maxSteps, phase: "consent",
        detail: consentResult.detail,
        data: { status: consentResult.status },
        timestamp: new Date().toISOString(),
      });
      // Update preview after consent handling
      await updatePreview(sessionId, "handle_consent");
      // If consent handling failed, stop the task early — no fake success
      if (consentResult.status === "error") {
        emit(taskId, sessionId, {
          type: "error", step: currentStep, maxSteps,
          detail: `Не удалось пройти consent. ${consentResult.detail}`,
          timestamp: new Date().toISOString(),
        });
        emit(taskId, sessionId, {
          type: "completed", step: currentStep, maxSteps,
          detail: "Задача завершена: consent-страница не преодолена",
          data: { success: false },
          timestamp: new Date().toISOString(),
        });
        return { results, snapshots, planSource };
      }
    }
  }

  // Anti-loop: track consecutive failures per (action, params, url) tuple
  const failCountByKey = new Map<string, number>();
  /** Max times the same action+params can fail on the same URL before we abort that action */
  const MAX_SAME_FAILURES = 2;
  /** Consecutive mid-loop consent page encounters — abort if we keep looping back */
  let consentLoopCount = 0;
  const MAX_CONSENT_LOOPS = 3;

  // ── Agentic loop ──
  while (currentStep < maxSteps) {
    // 1) SNAPSHOT — re-take to get current page state after navigation/fills
    emit(taskId, sessionId, { type: "observation", step: currentStep, maxSteps, phase: "observe", detail: "Сканирую DOM страницы...", timestamp: new Date().toISOString() });

    lastSnapshot = await takeSnapshot(p);

    // Mid-loop consent check: if we land on a consent page during navigation,
    // handle it immediately and continue the loop.
    if (isConsentPage(lastSnapshot)) {
      emit(taskId, sessionId, {
        type: "action", step: currentStep, maxSteps, phase: "consent",
        detail: `Consent/cookie страница обнаружена в цикле (${lastSnapshot.url}) — обрабатываю...`,
        timestamp: new Date().toISOString(),
      });
      const midConsentResult = await handleConsentPage(p);
      results.push(midConsentResult);
      executedActions.push("handle_consent_mid");
      await updatePreview(sessionId, "handle_consent");
      emit(taskId, sessionId, {
        type: "action_result", step: currentStep, maxSteps, phase: "consent",
        detail: midConsentResult.detail,
        data: { status: midConsentResult.status },
        timestamp: new Date().toISOString(),
      });
      if (midConsentResult.status === "error") {
        consentLoopCount++;
        emit(taskId, sessionId, {
          type: "warning", step: currentStep, maxSteps,
          detail: `Consent в цикле не пройден (попытка ${consentLoopCount}/${MAX_CONSENT_LOOPS}). ${midConsentResult.detail}`,
          timestamp: new Date().toISOString(),
        });
        if (consentLoopCount >= MAX_CONSENT_LOOPS) {
          emit(taskId, sessionId, {
            type: "error", step: currentStep, maxSteps,
            detail: `Consent-страница повторяется ${consentLoopCount}× — все стратегии исчерпаны, прекращаю.`,
            timestamp: new Date().toISOString(),
          });
          emit(taskId, sessionId, {
            type: "completed", step: currentStep, maxSteps,
            detail: "Задача завершена: consent-страница не преодолена в цикле",
            data: { success: false },
            timestamp: new Date().toISOString(),
          });
          return { results, snapshots, planSource };
        }
        // Not yet at max — increment step and let the loop try to make progress
        currentStep++;
        continue;
      }
      // Consent passed — reset loop counter
      consentLoopCount = 0;
      currentStep++;
      continue;
    }

    snapshots.push(lastSnapshot);

    const session = getOrCreateSession(sessionId);
    session.lastSnapshot = lastSnapshot;

    emit(taskId, sessionId, {
      type: "observation", step: currentStep, maxSteps, phase: "observe",
      detail: `${lastSnapshot.title} | ${lastSnapshot.elements.length} элементов (${lastSnapshot.stats.links}L ${lastSnapshot.stats.buttons}B ${lastSnapshot.stats.inputs}I ${lastSnapshot.stats.forms}F)`,
      data: { snapshot: lastSnapshot, url: lastSnapshot.url },
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
    // Use _key param for deduplication if present; otherwise fall back to bare action name
    const actionKey = nextAction.params?._key || nextAction.action;
    executedActions.push(actionKey);

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
      // ─ Anti-loop: count failures for this (action, params, url) combination ─
      const loopKey = makeLoopKey(nextAction.action, nextAction.params, lastSnapshot?.url || p.url());
      const prevFails = (failCountByKey.get(loopKey) || 0) + 1;
      failCountByKey.set(loopKey, prevFails);

      if (prevFails >= MAX_SAME_FAILURES) {
        emit(taskId, sessionId, {
          type: "warning", step: currentStep, maxSteps,
          detail: `Anti-loop: "действие ${nextAction.action}" провалилось ${prevFails}× на этой странице. Прекращаю повторные попытки.`,
          timestamp: new Date().toISOString(),
        });
        // Force this action-key into executedActions so the planner won't pick it again
        // Also add a sentinel to prevent the planner from re-selecting ANY variant of this action on the same page
        const antiLoopSentinel = `anti_loop:${nextAction.action}:${(lastSnapshot?.url || "").slice(0, 50)}`;
        if (!executedActions.includes(antiLoopSentinel)) {
          executedActions.push(antiLoopSentinel);
        }
      } else {
        emit(taskId, sessionId, { type: "warning", step: currentStep, detail: `${nextAction.action} не удалось (попытка ${prevFails}/${MAX_SAME_FAILURES}), ищу альтернативу...`, timestamp: new Date().toISOString() });
        if (lastSnapshot && lastSnapshot.elements.length > 0) {
          const altAction = findAlternativeAction(nextAction, lastSnapshot, executedActions);
          if (altAction) {
            emit(taskId, sessionId, { type: "reasoning", step: currentStep, phase: "reason", detail: `Альтернатива: ${altAction.action}`, data: { nextAction: altAction }, timestamp: new Date().toISOString() });
          }
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
