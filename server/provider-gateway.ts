/**
 * Local Comet — Provider Gateway
 * 
 * Adapters for Ollama and LM Studio local model providers.
 * Provides unified interface for health check, model listing, and chat.
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

function buildBaseUrl(config: ProviderConfig): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  return `${base}:${config.port}`;
}

// ---- Ollama Adapter ----

async function ollamaCheck(config: ProviderConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const url = `${buildBaseUrl(config)}/api/tags`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      return { ok: true, message: "Ollama доступен" };
    }
    return { ok: false, message: `Ollama вернул статус ${res.status}` };
  } catch (err: any) {
    return { ok: false, message: `Не удалось подключиться к Ollama: ${err.message}` };
  }
}

async function ollamaModels(config: ProviderConfig): Promise<string[]> {
  const url = `${buildBaseUrl(config)}/api/tags`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ollama /api/tags вернул ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m: any) => m.name || m.model);
}

async function ollamaChat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  const url = `${buildBaseUrl(config)}/api/chat`;
  const res = await fetch(url, {
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
  });
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
  try {
    const url = `${buildBaseUrl(config)}/v1/models`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      return { ok: true, message: "LM Studio доступен" };
    }
    return { ok: false, message: `LM Studio вернул статус ${res.status}` };
  } catch (err: any) {
    return { ok: false, message: `Не удалось подключиться к LM Studio: ${err.message}` };
  }
}

async function lmstudioModels(config: ProviderConfig): Promise<string[]> {
  const url = `${buildBaseUrl(config)}/v1/models`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LM Studio /v1/models вернул ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m: any) => m.id);
}

async function lmstudioChat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  const url = `${buildBaseUrl(config)}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: false,
    }),
  });
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
  if (config.providerType === "ollama") return ollamaCheck(config);
  if (config.providerType === "lmstudio") return lmstudioCheck(config);
  return { ok: false, message: `Неизвестный провайдер: ${config.providerType}` };
}

export async function listModels(config: ProviderConfig): Promise<string[]> {
  if (config.providerType === "ollama") return ollamaModels(config);
  if (config.providerType === "lmstudio") return lmstudioModels(config);
  throw new Error(`Неизвестный провайдер: ${config.providerType}`);
}

export async function chat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  if (config.providerType === "ollama") return ollamaChat(config, messages);
  if (config.providerType === "lmstudio") return lmstudioChat(config, messages);
  throw new Error(`Неизвестный провайдер: ${config.providerType}`);
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
