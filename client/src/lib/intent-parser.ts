/**
 * Intent Parser — local front-end engine for natural language command recognition.
 * Parses commands like "открой google", "найди в google ...", "открой сайт github.com"
 * into structured actions that can be executed immediately.
 */

export interface ParsedIntent {
  type: "open_site" | "search" | "navigate_url" | "agent_task" | "unknown";
  url?: string;
  query?: string;
  label?: string;
  confidence: number; // 0..1
}

// ── Known Sites / Aliases ─────────────────────────────────────────────────────

interface SiteAlias {
  names: string[];         // lowercase match patterns
  url: string;
  label: string;
  icon?: string;           // emoji for display
}

export const KNOWN_SITES: SiteAlias[] = [
  { names: ["google", "гугл", "гугле", "гугла"], url: "https://www.google.com", label: "Google", icon: "🔍" },
  { names: ["youtube", "ютуб", "ютубе", "ютуба", "yt"], url: "https://www.youtube.com", label: "YouTube", icon: "▶" },
  { names: ["github", "гитхаб", "гитхабе", "гитхаба", "gh"], url: "https://github.com", label: "GitHub", icon: "⬡" },
  { names: ["grok", "грок", "гроке", "грока", "x ai"], url: "https://grok.com", label: "Grok", icon: "✦" },
  { names: ["perplexity", "перплексити", "pplx"], url: "https://www.perplexity.ai", label: "Perplexity", icon: "◎" },
  { names: ["twitter", "твиттер", "x.com", "икс"], url: "https://x.com", label: "X / Twitter", icon: "𝕏" },
  { names: ["reddit", "реддит"], url: "https://www.reddit.com", label: "Reddit", icon: "◉" },
  { names: ["wikipedia", "вики", "википедия", "википедии"], url: "https://ru.wikipedia.org", label: "Wikipedia", icon: "W" },
  { names: ["hacker news", "hackernews", "hn", "хакер ньюс"], url: "https://news.ycombinator.com", label: "Hacker News", icon: "Y" },
  { names: ["habr", "хабр", "хабре", "хабра", "habrahabr"], url: "https://habr.com", label: "Habr", icon: "H" },
  { names: ["gmail", "почта google", "гмейл", "гмейле"], url: "https://mail.google.com", label: "Gmail", icon: "✉" },
  { names: ["яндекс", "yandex"], url: "https://ya.ru", label: "Яндекс", icon: "Я" },
  { names: ["stackoverflow", "стак", "стаковерфлоу", "so"], url: "https://stackoverflow.com", label: "Stack Overflow", icon: "⊞" },
  { names: ["chatgpt", "чатгпт", "openai", "опенай"], url: "https://chatgpt.com", label: "ChatGPT", icon: "◈" },
  { names: ["claude", "клод", "anthropic"], url: "https://claude.ai", label: "Claude", icon: "◇" },
];

// ── Search Engine Map ─────────────────────────────────────────────────────────

interface SearchEngine {
  names: string[];
  urlTemplate: string; // {q} will be replaced
  label: string;
}

const SEARCH_ENGINES: SearchEngine[] = [
  { names: ["google", "гугл", "гугле", "гугла"], urlTemplate: "https://www.google.com/search?q={q}", label: "Google" },
  { names: ["youtube", "ютуб", "ютубе", "ютуба", "yt"], urlTemplate: "https://www.youtube.com/results?search_query={q}", label: "YouTube" },
  { names: ["github", "гитхаб", "гитхабе", "гитхаба", "gh"], urlTemplate: "https://github.com/search?q={q}", label: "GitHub" },
  { names: ["reddit", "реддит"], urlTemplate: "https://www.reddit.com/search/?q={q}", label: "Reddit" },
  { names: ["wikipedia", "вики", "википедии"], urlTemplate: "https://ru.wikipedia.org/w/index.php?search={q}", label: "Wikipedia" },
  { names: ["яндекс", "yandex"], urlTemplate: "https://yandex.ru/search/?text={q}", label: "Яндекс" },
  { names: ["stackoverflow", "стаковерфлоу", "so"], urlTemplate: "https://stackoverflow.com/search?q={q}", label: "Stack Overflow" },
  { names: ["perplexity", "перплексити", "pplx"], urlTemplate: "https://www.perplexity.ai/search?q={q}", label: "Perplexity" },
];

// ── Open patterns (RU + EN) ──────────────────────────────────────────────────

const OPEN_PATTERNS = [
  /^(?:открой|открыть|зайди на|зайти на|перейди на|перейти на|go to|open|launch|запусти)\s+(.+)$/i,
  /^(.+)\s+(?:открой|открыть)$/i,
];

const SEARCH_PATTERNS = [
  /^(?:найди|найти|поиск|ищи|искать|search|find|search for|look up|погугли|загугли)\s+(?:в|в\s+|on|in|at)\s+(\S+)\s+(.+)$/i,
  /^(?:найди|найти|поиск|ищи|искать|search|find|search for|look up|погугли|загугли)\s+(.+)$/i,
];

const URL_PATTERN = /^(?:https?:\/\/)?[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(?:[\/\w\-.~:?#[\]@!$&'()*+,;=]*)?$/i;

// ── Parser ───────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[«»""]/g, "");
}

function findSite(query: string): SiteAlias | undefined {
  const q = normalize(query);
  return KNOWN_SITES.find(s => s.names.some(n => q === n || q.includes(n)));
}

function findSearchEngine(query: string): SearchEngine | undefined {
  const q = normalize(query);
  return SEARCH_ENGINES.find(e => e.names.some(n => q === n || q.startsWith(n)));
}

export function parseIntent(input: string): ParsedIntent {
  const raw = input.trim();
  if (!raw) return { type: "unknown", confidence: 0 };

  const lower = normalize(raw);

  // 1) Check search patterns first (more specific)
  for (const pat of SEARCH_PATTERNS) {
    const m = raw.match(pat);
    if (m) {
      if (m.length === 3) {
        // "найди в google машинное обучение"
        const engine = findSearchEngine(m[1]);
        const query = m[2].trim();
        if (engine && query) {
          return {
            type: "search",
            url: engine.urlTemplate.replace("{q}", encodeURIComponent(query)),
            query,
            label: `Поиск в ${engine.label}: ${query}`,
            confidence: 0.95,
          };
        }
      }
      if (m.length === 2) {
        // "найди машинное обучение" → google by default
        const query = m[1].trim();
        if (query) {
          return {
            type: "search",
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
            query,
            label: `Поиск в Google: ${query}`,
            confidence: 0.85,
          };
        }
      }
    }
  }

  // 2) Check open patterns
  for (const pat of OPEN_PATTERNS) {
    const m = raw.match(pat);
    if (m) {
      const target = m[1].trim();

      // Check if it's a known site name
      const site = findSite(target);
      if (site) {
        return {
          type: "open_site",
          url: site.url,
          label: `Открыть ${site.label}`,
          confidence: 0.95,
        };
      }

      // Check if it's "сайт domain.com" or just a domain
      const siteMatch = target.match(/^(?:сайт|сайте|site)\s+(.+)$/i);
      if (siteMatch) {
        const domain = siteMatch[1].trim();
        const url = domain.startsWith("http") ? domain : `https://${domain}`;
        return {
          type: "navigate_url",
          url,
          label: `Открыть ${domain}`,
          confidence: 0.9,
        };
      }

      // Check if it looks like a URL/domain
      if (URL_PATTERN.test(target)) {
        const url = target.startsWith("http") ? target : `https://${target}`;
        return {
          type: "navigate_url",
          url,
          label: `Открыть ${target}`,
          confidence: 0.9,
        };
      }

      // Unknown site name — try as a known site fuzzy match
      const fuzzy = findSite(target);
      if (fuzzy) {
        return {
          type: "open_site",
          url: fuzzy.url,
          label: `Открыть ${fuzzy.label}`,
          confidence: 0.8,
        };
      }
    }
  }

  // 3) Bare known site names (just "google", "grok", "youtube")
  const bareSite = findSite(lower);
  if (bareSite && lower.split(/\s+/).length <= 2) {
    return {
      type: "open_site",
      url: bareSite.url,
      label: `Открыть ${bareSite.label}`,
      confidence: 0.85,
    };
  }

  // 4) Bare URL
  if (URL_PATTERN.test(raw)) {
    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    return {
      type: "navigate_url",
      url,
      label: `Открыть ${raw}`,
      confidence: 0.9,
    };
  }

  // 5) Fallback — treat as agent task (natural language goal)
  return {
    type: "agent_task",
    query: raw,
    label: raw,
    confidence: 0.5,
  };
}

// ── Example Commands (for onboarding display) ────────────────────────────────

export interface ExampleCommand {
  text: string;
  description: string;
  icon: string;
}

export const EXAMPLE_COMMANDS: ExampleCommand[] = [
  { text: "открой google", description: "Мгновенно откроет Google", icon: "🔍" },
  { text: "открой github", description: "Откроет GitHub", icon: "⬡" },
  { text: "найди в google нейросети 2026", description: "Поиск в Google", icon: "🌐" },
  { text: "открой youtube", description: "Откроет YouTube", icon: "▶" },
  { text: "открой сайт habr.com", description: "Откроет любой сайт", icon: "🌍" },
];

// ── Capability descriptions ──────────────────────────────────────────────────

export interface Capability {
  title: string;
  description: string;
  icon: string;
}

export const CAPABILITIES: Capability[] = [
  { title: "Открыть сайт", description: "«открой google» / «открой github»", icon: "🌐" },
  { title: "Поиск", description: "«найди в google ...» / «найди ...»", icon: "🔍" },
  { title: "Исследовать страницу", description: "Анализ структуры, DOM, навигации", icon: "🔬" },
  { title: "Выполнить задачу", description: "Заполнить форму, кликнуть, действовать", icon: "⚡" },
  { title: "Суммаризировать", description: "Краткое содержание любой страницы", icon: "📝" },
];
