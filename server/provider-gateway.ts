/**
 * Local Comet — Provider Gateway
 *
 * Adapters for Ollama and LM Studio local model providers.
 * Provides unified interface for health check, model listing, and chat.
 *
 * URL normalisation rules:
 *   - Strip trailing slashes from baseUrl.
 *   - If baseUrl already contains a port (host:PORT), do NOT append port again.
 *   - Otherwise append :port.
 *   - Both http:// and https:// are preserved as-is.
 */

interface ProviderConfig {
  providerType: string;
  baseUrl: string;
  port: number;
  model: string;
  temperature: number;
  maxTokens: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  tokenCount?: number;
}

/**
 * Build the effective base URL for a provider.
 *
 * Handles four cases:
 *   1. baseUrl is just a scheme+host with no port  → append :port
 *   2. baseUrl already has a port                  → use as-is
 *   3. baseUrl already contains :port that matches → use as-is
 *   4. baseUrl contains a different explicit port  → trust the explicit port (user override)
 */
function buildBaseUrl(config: ProviderConfig): string {
  const base = config.baseUrl.replace(/\/+$/, ""); // strip trailing slashes

  // Parse whether the URL already contains an explicit port segment
  // e.g. "http://localhost:11434" or "http://192.168.1.1:8080"
  const portInUrl = base.match(/:[0-9]+$/);
  if (portInUrl) {
    // URL already has an explicit port — respect it, don't double-append
    return base;
  }

  return `${base}:${config.port}`;
}

// Shared fetch helper with timeout
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- Ollama Adapter ----

async function ollamaCheck(config: ProviderConfig): Promise<{ ok: boolean; message: string }> {
  const base = buildBaseUrl(config);
  const url = `${base}/api/tags`;
  try {
    const res = await fetchWithTimeout(url, {}, 5000);
    if (res.ok) {
      return { ok: true, message: "Ollama доступен" };
    }
    return { ok: false, message: `Ollama вернул статус ${res.status}` };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, message: `Ollama (${base}): таймаут подключения` };
    }
    return { ok: false, message: `Не удалось подключиться к Ollama (${base}): ${err.message}` };
  }
}

async function ollamaModels(config: ProviderConfig): Promise<string[]> {
  const url = `${buildBaseUrl(config)}/api/tags`;
  const res = await fetchWithTimeout(url, {}, 8000);
  if (!res.ok) throw new Error(`Ollama /api/tags вернул ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m: any) => m.name || m.model).filter(Boolean);
}

async function ollamaChat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  const url = `${buildBaseUrl(config)}/api/chat`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        options: {
          temperature: config.temperature,
          num_predict: config.maxTokens,
        },
      }),
    },
    60000
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama chat ошибка ${res.status}: ${text}`);
  }
  const data = await res.json();
  return {
    content: data.message?.content || "",
    model: config.model,
    provider: "ollama",
    tokenCount: data.eval_count,
  };
}

// ---- LM Studio Adapter ----

async function lmstudioCheck(config: ProviderConfig): Promise<{ ok: boolean; message: string }> {
  const base = buildBaseUrl(config);
  const url = `${base}/v1/models`;
  try {
    const res = await fetchWithTimeout(url, {}, 5000);
    if (res.ok) {
      return { ok: true, message: "LM Studio доступен" };
    }
    return { ok: false, message: `LM Studio вернул статус ${res.status}` };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, message: `LM Studio (${base}): таймаут подключения` };
    }
    return { ok: false, message: `Не удалось подключиться к LM Studio (${base}): ${err.message}` };
  }
}

async function lmstudioModels(config: ProviderConfig): Promise<string[]> {
  const url = `${buildBaseUrl(config)}/v1/models`;
  const res = await fetchWithTimeout(url, {}, 8000);
  if (!res.ok) throw new Error(`LM Studio /v1/models вернул ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m: any) => m.id).filter(Boolean);
}

async function lmstudioChat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  const url = `${buildBaseUrl(config)}/v1/chat/completions`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
      }),
    },
    60000
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM Studio chat ошибка ${res.status}: ${text}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || "",
    model: config.model,
    provider: "lmstudio",
    tokenCount: data.usage?.completion_tokens,
  };
}

// ---- Unified Gateway ----

export async function checkProvider(config: ProviderConfig): Promise<{ ok: boolean; message: string }> {
  switch (config.providerType) {
    case "ollama":   return ollamaCheck(config);
    case "lmstudio": return lmstudioCheck(config);
    default:
      return { ok: false, message: `Неизвестный провайдер: ${config.providerType}` };
  }
}

export async function listModels(config: ProviderConfig): Promise<string[]> {
  switch (config.providerType) {
    case "ollama":   return ollamaModels(config);
    case "lmstudio": return lmstudioModels(config);
    default:
      throw new Error(`Неизвестный провайдер: ${config.providerType}`);
  }
}

export async function chat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  switch (config.providerType) {
    case "ollama":   return ollamaChat(config, messages);
    case "lmstudio": return lmstudioChat(config, messages);
    default:
      throw new Error(`Неизвестный провайдер: ${config.providerType}`);
  }
}

/**
 * Try to get a plan from the model for the given goal/url.
 * Returns null if model is unavailable — caller should use fallback.
 */
export async function requestPlanFromModel(
  config: ProviderConfig,
  goal: string,
  url: string,
  pageContext?: string,
): Promise<any[] | null> {
  try {
    const systemPrompt = `Ты — планировщик автономного браузерного агента Local Comet.
Тебе дают URL страницы и цель задачи. Верни JSON-массив шагов.
Каждый шаг — объект { "action": "...", "params": {...} }.
Доступные действия:
- navigate (params: { url })
- read_title
- extract_text
- find_links
- find_buttons
- click_link (params: { text }) — только если это безопасно
- fill_input (params: { placeholder, value })
- summarize_page
Верни ТОЛЬКО JSON-массив, без комментариев.`;

    const userMsg = `URL: ${url}\nЦель: ${goal}${pageContext ? `\nКонтекст страницы: ${pageContext}` : ""}`;

    const response = await chat(config, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ]);

    // Try to parse JSON from response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch {
    return null;
  }
}
