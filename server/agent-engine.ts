/**
 * Local Comet — Browser Agent Engine
 * 
 * Uses Playwright to perform safe browser actions.
 * Supports: navigate, read title, extract text, find links/buttons,
 * click link by text, fill input by placeholder, summarize page.
 */

import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

export interface AgentAction {
  action: string;
  params?: Record<string, string>;
}

export interface AgentStepResult {
  action: string;
  status: "success" | "error" | "warning" | "blocked";
  detail: string;
  data?: any;
}

// Allowed safe actions
const SAFE_ACTIONS = new Set([
  "navigate",
  "read_title",
  "extract_text",
  "find_links",
  "find_buttons",
  "click_link",
  "fill_input",
  "summarize_page",
  "screenshot_description",
]);

// Dangerous patterns — block these
const DANGEROUS_URL_PATTERNS = [
  /javascript:/i,
  /data:/i,
  /^file:/i,
];

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

export async function initBrowser(): Promise<void> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: "LocalComet/1.0 (Browser Agent Prototype)",
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
  }
}

function getPage(): Page {
  if (!page) throw new Error("Браузер не инициализирован");
  return page;
}

function isUrlSafe(url: string): boolean {
  for (const pattern of DANGEROUS_URL_PATTERNS) {
    if (pattern.test(url)) return false;
  }
  return true;
}

export async function executeAction(
  action: AgentAction,
  safetyMode: string = "readonly"
): Promise<AgentStepResult> {
  const { action: actionName, params = {} } = action;

  if (!SAFE_ACTIONS.has(actionName)) {
    return {
      action: actionName,
      status: "blocked",
      detail: `Действие "${actionName}" не входит в список разрешённых`,
    };
  }

  try {
    await initBrowser();
    const p = getPage();

    switch (actionName) {
      case "navigate": {
        const url = params.url;
        if (!url) return { action: actionName, status: "error", detail: "URL не указан" };
        if (!isUrlSafe(url)) return { action: actionName, status: "blocked", detail: "URL заблокирован по соображениям безопасности" };
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        const title = await p.title();
        return {
          action: actionName,
          status: "success",
          detail: `Открыта страница: ${title}`,
          data: { url: p.url(), title },
        };
      }

      case "read_title": {
        const title = await p.title();
        return {
          action: actionName,
          status: "success",
          detail: `Заголовок: ${title}`,
          data: { title },
        };
      }

      case "extract_text": {
        const text = await p.evaluate(() => {
          const body = document.body;
          // Remove script/style/nav/header/footer content for cleaner text
          const clone = body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("script, style, nav, header, footer, iframe, noscript").forEach(el => el.remove());
          return (clone.innerText || clone.textContent || "").trim().slice(0, 5000);
        });
        return {
          action: actionName,
          status: "success",
          detail: `Извлечено ${text.length} символов текста`,
          data: { text: text.slice(0, 3000), fullLength: text.length },
        };
      }

      case "find_links": {
        const links = await p.evaluate(() => {
          return Array.from(document.querySelectorAll("a[href]")).slice(0, 30).map(a => ({
            text: (a as HTMLAnchorElement).innerText?.trim().slice(0, 100) || "[без текста]",
            href: (a as HTMLAnchorElement).href,
          }));
        });
        return {
          action: actionName,
          status: "success",
          detail: `Найдено ${links.length} ссылок`,
          data: { links },
        };
      }

      case "find_buttons": {
        const buttons = await p.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']"));
          return btns.slice(0, 20).map(b => ({
            text: (b as HTMLElement).innerText?.trim().slice(0, 100) || (b as HTMLInputElement).value || "[без текста]",
            type: b.tagName.toLowerCase(),
          }));
        });
        return {
          action: actionName,
          status: "success",
          detail: `Найдено ${buttons.length} кнопок`,
          data: { buttons },
        };
      }

      case "click_link": {
        if (safetyMode === "readonly") {
          return {
            action: actionName,
            status: "blocked",
            detail: "Клик по ссылке заблокирован: режим «Только чтение»",
          };
        }
        const linkText = params.text;
        if (!linkText) return { action: actionName, status: "error", detail: "Текст ссылки не указан" };
        
        if (safetyMode === "confirm") {
          return {
            action: actionName,
            status: "warning",
            detail: `⚠️ Агент хочет нажать на ссылку: "${linkText}". Требуется подтверждение.`,
            data: { requiresConfirmation: true, linkText },
          };
        }
        
        const link = p.locator(`a:has-text("${linkText}")`).first();
        await link.click({ timeout: 5000 });
        await p.waitForLoadState("domcontentloaded");
        const newTitle = await p.title();
        return {
          action: actionName,
          status: "success",
          detail: `Переход по ссылке "${linkText}" → ${newTitle}`,
          data: { url: p.url(), title: newTitle },
        };
      }

      case "fill_input": {
        if (safetyMode === "readonly") {
          return {
            action: actionName,
            status: "blocked",
            detail: "Заполнение поля заблокировано: режим «Только чтение»",
          };
        }
        const placeholder = params.placeholder;
        const value = params.value;
        if (!placeholder || !value) return { action: actionName, status: "error", detail: "Не указаны placeholder или value" };

        if (safetyMode === "confirm") {
          return {
            action: actionName,
            status: "warning",
            detail: `⚠️ Агент хочет заполнить поле "${placeholder}" значением "${value}". Требуется подтверждение.`,
            data: { requiresConfirmation: true, placeholder, value },
          };
        }

        const input = p.locator(`input[placeholder*="${placeholder}"], textarea[placeholder*="${placeholder}"]`).first();
        await input.fill(value, { timeout: 5000 });
        return {
          action: actionName,
          status: "success",
          detail: `Заполнено поле "${placeholder}" значением "${value}"`,
        };
      }

      case "summarize_page": {
        // Extract text and provide structured info for summarization
        const pageData = await p.evaluate(() => {
          const title = document.title;
          const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
          const h1s = Array.from(document.querySelectorAll("h1")).map(h => h.innerText.trim()).slice(0, 3);
          const h2s = Array.from(document.querySelectorAll("h2")).map(h => h.innerText.trim()).slice(0, 8);
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll("script, style, nav, header, footer, iframe").forEach(el => el.remove());
          const bodyText = (clone.innerText || "").trim().slice(0, 2000);
          const linkCount = document.querySelectorAll("a[href]").length;
          const imgCount = document.querySelectorAll("img").length;
          const formCount = document.querySelectorAll("form").length;
          return { title, metaDesc, h1s, h2s, bodyText, linkCount, imgCount, formCount };
        });
        
        return {
          action: actionName,
          status: "success",
          detail: `Суммаризация страницы: "${pageData.title}"`,
          data: {
            title: pageData.title,
            description: pageData.metaDesc,
            headings: { h1: pageData.h1s, h2: pageData.h2s },
            textPreview: pageData.bodyText.slice(0, 500),
            stats: {
              links: pageData.linkCount,
              images: pageData.imgCount,
              forms: pageData.formCount,
              textLength: pageData.bodyText.length,
            },
          },
        };
      }

      case "screenshot_description": {
        // Return a text description of visible elements instead of actual screenshot
        const desc = await p.evaluate(() => {
          const title = document.title;
          const url = window.location.href;
          const visibleText = document.body.innerText?.slice(0, 500) || "";
          return `Страница: ${title}\nURL: ${url}\nВидимый текст: ${visibleText}`;
        });
        return {
          action: actionName,
          status: "success",
          detail: desc.slice(0, 500),
        };
      }

      default:
        return { action: actionName, status: "error", detail: `Неизвестное действие: ${actionName}` };
    }
  } catch (err: any) {
    return {
      action: actionName,
      status: "error",
      detail: `Ошибка: ${err.message || String(err)}`,
    };
  }
}

/**
 * Generate a plan of actions given a goal and URL.
 * If a real model is available, use it. Otherwise, use a heuristic plan.
 */
export function generateFallbackPlan(goal: string, url: string): AgentAction[] {
  const lowerGoal = goal.toLowerCase();
  
  const plan: AgentAction[] = [
    { action: "navigate", params: { url } },
    { action: "read_title" },
  ];

  if (lowerGoal.includes("суммариз") || lowerGoal.includes("обзор") || lowerGoal.includes("содержим")) {
    plan.push({ action: "extract_text" });
    plan.push({ action: "summarize_page" });
  } else if (lowerGoal.includes("ссылк") || lowerGoal.includes("навигац") || lowerGoal.includes("исследов")) {
    plan.push({ action: "find_links" });
    plan.push({ action: "extract_text" });
    plan.push({ action: "summarize_page" });
  } else if (lowerGoal.includes("форм") || lowerGoal.includes("обратн")) {
    plan.push({ action: "find_buttons" });
    plan.push({ action: "find_links" });
    plan.push({ action: "extract_text" });
  } else if (lowerGoal.includes("план") || lowerGoal.includes("действи")) {
    plan.push({ action: "summarize_page" });
    plan.push({ action: "find_links" });
    plan.push({ action: "find_buttons" });
  } else {
    // Generic exploration
    plan.push({ action: "extract_text" });
    plan.push({ action: "find_links" });
    plan.push({ action: "summarize_page" });
  }

  return plan;
}

/**
 * Execute a full agent run: plan → execute each step → collect log
 */
export async function runAgentTask(
  url: string,
  goal: string,
  safetyMode: string,
  modelPlan?: AgentAction[] | null,
): Promise<{ plan: AgentAction[]; results: AgentStepResult[] }> {
  const plan = modelPlan || generateFallbackPlan(goal, url);
  const results: AgentStepResult[] = [];

  for (const step of plan) {
    const result = await executeAction(step, safetyMode);
    results.push(result);
    // If navigation failed, abort remaining
    if (result.status === "error" && step.action === "navigate") break;
  }

  return { plan, results };
}
