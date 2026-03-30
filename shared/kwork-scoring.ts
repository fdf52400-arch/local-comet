/**
 * Kwork Lead Scoring Engine
 * Computes fit score (0-100) and recommendation for a Kwork project lead.
 * Shared between server (routes) and can be imported client-side for preview.
 */

export interface KworkScoringInput {
  budget: number;
  brief: string;
  category: string;
  title: string;
  flagFitsProfile: boolean;
  flagNeedsCall: boolean;
  flagNeedsAccess: boolean;
  flagNeedsDesign: boolean;
  flagNeedsMobile: boolean;
  flagCloudVmFit: boolean;
}

export interface KworkScoringOutput {
  fitScore: number;                  // 0–100
  recommendation: "reject" | "review_manually" | "strong_fit";
  whyFits: string[];
  keyRisks: string[];
}

// Profile stack keywords (high relevance)
const STACK_AI = ["ai", "gpt", "llm", "openai", "claude", "gemini", "автоматизац", "нейросет", "машинн", "искусств", "ai-agent", "ai agent", "language model"];
const STACK_AUTOMATION = ["автоматизац", "automation", "парсинг", "parsing", "бот", "bot", "скрипт", "script", "расписание", "schedule", "workflow", "пайплайн"];
const STACK_WEB = ["web", "сайт", "website", "landing", "лендинг", "react", "vue", "next", "nuxt", "html", "css", "frontend", "бэкенд", "backend", "api", "rest", "graphql"];
const STACK_TELEGRAM = ["telegram", "телеграм", "tg", "бот", "bot", "webhook"];
const STACK_BROWSER_AGENT = ["playwright", "selenium", "puppeteer", "browser", "браузер", "автоматизация браузера", "web scraping", "парсинг сайт"];
const STACK_INTEGRATION = ["интеграция", "integration", "api", "webhook", "zapier", "make.com", "n8n", "crm", "airtable", "notion", "slack"];
const STACK_CLOUD = ["cloud", "облако", "docker", "vps", "сервер", "deploy", "деплой", "linux"];

// Penalty keywords
const VAGUE_BRIEF_SIGNALS = ["и т.д", "и т.п", "аналог", "по образцу", "как у", "похожее", "похожий", "примерно", "что-то вроде", "что нибудь"];
const STORE_SIGNALS = ["app store", "google play", "мобильное приложение", "ios app", "android app", "flutter", "react native", "swift", "kotlin"];
const HEAVY_CALL_SIGNALS = ["созвон обязательн", "сначала обсудим", "только по телефону", "встреча обязательна", "нужно встретиться"];

function matchKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter(kw => lower.includes(kw));
}

function hasAny(text: string, keywords: string[]): boolean {
  return matchKeywords(text, keywords).length > 0;
}

export function scoreKworkLead(input: KworkScoringInput): KworkScoringOutput {
  const fullText = `${input.title} ${input.brief} ${input.category}`.toLowerCase();
  const whyFits: string[] = [];
  const keyRisks: string[] = [];
  let score = 0;

  // ── 1. Budget gate ────────────────────────────────────────────────────────
  if (input.budget < 50_000) {
    // Hard filter — budget below threshold
    return {
      fitScore: Math.max(0, Math.round(input.budget / 1000)),
      recommendation: "reject",
      whyFits: [],
      keyRisks: [
        `Бюджет ${input.budget.toLocaleString("ru-RU")} ₽ ниже порога 50 000 ₽`,
        "Низкие бюджеты несовместимы с AI/automation профилем",
      ],
    };
  }

  // Passed budget gate → base 30 points
  score += 30;
  whyFits.push(`Бюджет ${input.budget.toLocaleString("ru-RU")} ₽ — проходит базовый фильтр`);

  if (input.budget >= 100_000) {
    score += 10;
    whyFits.push("Бюджет ≥ 100 000 ₽ — высокий приоритет");
  } else if (input.budget >= 75_000) {
    score += 5;
    whyFits.push("Бюджет ≥ 75 000 ₽ — хороший приоритет");
  }

  // ── 2. Stack / profile fit bonuses ───────────────────────────────────────
  const aiMatches = matchKeywords(fullText, STACK_AI);
  if (aiMatches.length > 0) {
    score += 15;
    whyFits.push(`AI/LLM fit: ${aiMatches.slice(0, 3).join(", ")}`);
  }

  const automationMatches = matchKeywords(fullText, STACK_AUTOMATION);
  if (automationMatches.length > 0) {
    score += 10;
    whyFits.push(`Automation fit: ${automationMatches.slice(0, 3).join(", ")}`);
  }

  const tgMatches = matchKeywords(fullText, STACK_TELEGRAM);
  if (tgMatches.length > 0) {
    score += 8;
    whyFits.push(`Telegram bot fit: ${tgMatches.slice(0, 2).join(", ")}`);
  }

  const webMatches = matchKeywords(fullText, STACK_WEB);
  if (webMatches.length > 0) {
    score += 6;
    whyFits.push(`Web stack fit: ${webMatches.slice(0, 3).join(", ")}`);
  }

  const browserMatches = matchKeywords(fullText, STACK_BROWSER_AGENT);
  if (browserMatches.length > 0) {
    score += 12;
    whyFits.push(`Browser automation fit: ${browserMatches.slice(0, 2).join(", ")}`);
  }

  const integrationMatches = matchKeywords(fullText, STACK_INTEGRATION);
  if (integrationMatches.length > 0) {
    score += 8;
    whyFits.push(`Integration fit: ${integrationMatches.slice(0, 3).join(", ")}`);
  }

  const cloudMatches = matchKeywords(fullText, STACK_CLOUD);
  if (cloudMatches.length > 0) {
    score += 5;
    whyFits.push(`Cloud/infra fit: ${cloudMatches.slice(0, 2).join(", ")}`);
  }

  // Profile flag bonus
  if (input.flagFitsProfile) {
    score += 10;
    whyFits.push("Помечено: подходит под профиль");
  }
  if (input.flagCloudVmFit) {
    score += 8;
    whyFits.push("Подходит для Computer + Cloud VM workflow");
  }

  // ── 3. Penalty signals ───────────────────────────────────────────────────
  // Vague brief
  if (hasAny(fullText, VAGUE_BRIEF_SIGNALS) || input.brief.length < 30) {
    score -= 10;
    keyRisks.push("Расплывчатое или слишком короткое ТЗ — нужен полный анализ заказа");
  }

  // Store publishing
  if (hasAny(fullText, STORE_SIGNALS) || input.flagNeedsMobile) {
    score -= 15;
    keyRisks.push("Требуется мобильное приложение / публикация в сторах — не в профиле");
  }

  // Heavy manual communication requirement
  if (hasAny(fullText, HEAVY_CALL_SIGNALS) || input.flagNeedsCall) {
    score -= 8;
    keyRisks.push("Требуется ручной созвон / встреча — снижает async-эффективность");
  }

  // Unclear access / credentials
  if (input.flagNeedsAccess) {
    score -= 5;
    keyRisks.push("Нужны доступы к аккаунтам заказчика — риск блокировок и задержек");
  }

  // Design dependency
  if (input.flagNeedsDesign) {
    score -= 8;
    keyRisks.push("Требуется дизайн — не в core профиле");
  }

  // No brief available
  if (input.brief.trim().length === 0) {
    score -= 15;
    keyRisks.push("Полное ТЗ недоступно — получено только из email-дайджеста; нужно открыть страницу заказа");
  }

  // ── 4. Clamp and recommendation ──────────────────────────────────────────
  score = Math.max(0, Math.min(100, score));

  let recommendation: "reject" | "review_manually" | "strong_fit";
  if (score >= 70) {
    recommendation = "strong_fit";
  } else if (score >= 40) {
    recommendation = "review_manually";
  } else {
    recommendation = "reject";
  }

  // If no URL and no brief — downgrade
  if (whyFits.length <= 1 && keyRisks.length >= 2) {
    recommendation = "review_manually";
  }

  return { fitScore: score, recommendation, whyFits, keyRisks };
}
