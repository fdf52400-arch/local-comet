/**
 * Local Comet — Provider Gateway
 *
 * Adapters for local (Ollama, LM Studio) and cloud (OpenAI, Anthropic, Gemini,
 * OpenAI-compatible) model providers.
 * Provides unified interface for health check, model listing, and chat.
 *
 * URL normalisation rules (local providers):
 *   - Strip trailing slashes from baseUrl.
 *   - If baseUrl already contains a port (host:PORT), do NOT append port again.
 *   - Otherwise append :port.
 *   - Both http:// and https:// are preserved as-is.
 */

/** Unified provider availability status for UI consumption */
export type ProviderStatus = "available" | "unavailable" | "timeout" | "unsupported" | "error";

export interface ProviderCheckResult {
  ok: boolean;
  status: ProviderStatus;
  message: string;
  /** HTTP status code from the remote, if a response was received */
  httpStatus?: number;
}

interface ProviderConfig {
  providerType: string;
  baseUrl: string;
  port: number;
  model: string;
  apiKey: string;
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
 * Build the effective base URL for a local provider.
 */
function buildBaseUrl(config: ProviderConfig): string {
  const base = config.baseUrl.replace(/\/+$/, ""); // strip trailing slashes
  const portInUrl = base.match(/:[0-9]+$/);
  if (portInUrl) {
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

async function ollamaCheck(config: ProviderConfig): Promise<ProviderCheckResult> {
  const base = buildBaseUrl(config);
  const url = `${base}/api/tags`;
  try {
    const res = await fetchWithTimeout(url, {}, 5000);
    if (res.ok) {
      return { ok: true, status: "available", message: "Ollama доступен" };
    }
    return {
      ok: false,
      status: res.status === 404 ? "unsupported" : "unavailable",
      message: `Ollama вернул статус ${res.status}`,
      httpStatus: res.status,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, status: "timeout", message: `Ollama (${base}): таймаут подключения` };
    }
    const rawMsg = `${err.message || ""} ${(err as any).cause?.code || ""}`;
    const isRefused = /ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(rawMsg);
    return {
      ok: false,
      status: isRefused ? "unavailable" : "error",
      message: `Не удалось подключиться к Ollama (${base}): ${err.message}`,
    };
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

async function lmstudioCheck(config: ProviderConfig): Promise<ProviderCheckResult> {
  const base = buildBaseUrl(config);
  const url = `${base}/v1/models`;
  try {
    const res = await fetchWithTimeout(url, {}, 5000);
    if (res.ok) {
      return { ok: true, status: "available", message: "LM Studio доступен" };
    }
    return {
      ok: false,
      status: res.status === 404 ? "unsupported" : "unavailable",
      message: `LM Studio вернул статус ${res.status}`,
      httpStatus: res.status,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, status: "timeout", message: `LM Studio (${base}): таймаут подключения` };
    }
    const rawMsg = `${err.message || ""} ${(err as any).cause?.code || ""}`;
    const isRefused = /ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(rawMsg);
    return {
      ok: false,
      status: isRefused ? "unavailable" : "error",
      message: `Не удалось подключиться к LM Studio (${base}): ${err.message}`,
    };
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

// ---- OpenAI Adapter ----

async function openaiCheck(config: ProviderConfig): Promise<ProviderCheckResult> {
  if (!config.apiKey || config.apiKey.trim() === "") {
    return {
      ok: false,
      status: "error",
      message: "OpenAI: не указан API key. Укажите ключ в настройках.",
    };
  }
  try {
    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/models",
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
      },
      8000
    );
    if (res.ok) {
      return { ok: true, status: "available", message: "OpenAI API доступен, ключ действителен" };
    }
    if (res.status === 401) {
      return { ok: false, status: "error", message: "OpenAI: неверный API key (401 Unauthorized)", httpStatus: 401 };
    }
    if (res.status === 429) {
      return { ok: false, status: "error", message: "OpenAI: превышен лимит запросов (429 Rate Limit)", httpStatus: 429 };
    }
    return {
      ok: false,
      status: "unavailable",
      message: `OpenAI API вернул статус ${res.status}`,
      httpStatus: res.status,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, status: "timeout", message: "OpenAI API: таймаут подключения (8s)" };
    }
    return { ok: false, status: "error", message: `OpenAI: ошибка подключения: ${err.message}` };
  }
}

async function openaiModels(config: ProviderConfig): Promise<string[]> {
  if (!config.apiKey) throw new Error("OpenAI: API key не задан");
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/models",
    {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    },
    10000
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI /v1/models вернул ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // Filter to chat-capable models only, sorted by id
  const chatModels: string[] = (data.data || [])
    .map((m: any) => m.id as string)
    .filter((id: string) => /gpt|o1|o3/.test(id))
    .sort((a: string, b: string) => b.localeCompare(a));
  return chatModels.length > 0 ? chatModels : (data.data || []).map((m: any) => m.id);
}

async function openaiChat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  if (!config.apiKey) throw new Error("OpenAI: API key не задан");
  const model = config.model || "gpt-4o";
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
    },
    90000
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI chat ошибка ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || "",
    model: data.model || model,
    provider: "openai",
    tokenCount: data.usage?.completion_tokens,
  };
}

// ---- Anthropic Adapter ----

async function anthropicCheck(config: ProviderConfig): Promise<ProviderCheckResult> {
  if (!config.apiKey || config.apiKey.trim() === "") {
    return {
      ok: false,
      status: "error",
      message: "Anthropic: не указан API key. Укажите ключ в настройках.",
    };
  }
  // Anthropic doesn't have a simple /models endpoint that works without a real request.
  // We do a minimal messages request to verify the key.
  try {
    const res = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model || "claude-3-5-haiku-20241022",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      },
      10000
    );
    if (res.ok || res.status === 400) {
      // 400 can mean model/params issue but key is valid
      const body = await res.json().catch(() => ({}));
      if (res.ok || (body.type === "error" && body.error?.type !== "authentication_error")) {
        return { ok: true, status: "available", message: "Anthropic API доступен, ключ действителен" };
      }
    }
    if (res.status === 401) {
      return { ok: false, status: "error", message: "Anthropic: неверный API key (401 Unauthorized)", httpStatus: 401 };
    }
    if (res.status === 403) {
      return { ok: false, status: "error", message: "Anthropic: доступ запрещён (403 Forbidden)", httpStatus: 403 };
    }
    if (res.status === 429) {
      return { ok: false, status: "error", message: "Anthropic: превышен лимит запросов (429)", httpStatus: 429 };
    }
    const body = await res.json().catch(() => ({}));
    if (body?.error?.type === "authentication_error") {
      return { ok: false, status: "error", message: "Anthropic: неверный API key", httpStatus: res.status };
    }
    return {
      ok: false,
      status: "unavailable",
      message: `Anthropic API вернул статус ${res.status}`,
      httpStatus: res.status,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, status: "timeout", message: "Anthropic API: таймаут подключения (10s)" };
    }
    return { ok: false, status: "error", message: `Anthropic: ошибка подключения: ${err.message}` };
  }
}

/** Anthropic doesn't have a public model list endpoint. Return well-known models. */
function anthropicModels(): string[] {
  return [
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
  ];
}

async function anthropicChat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  if (!config.apiKey) throw new Error("Anthropic: API key не задан");
  const model = config.model || "claude-3-5-sonnet-20241022";

  // Separate system message from conversation messages
  const systemMessages = messages.filter(m => m.role === "system");
  const convoMessages = messages.filter(m => m.role !== "system");
  const systemPrompt = systemMessages.map(m => m.content).join("\n\n");

  const body: Record<string, any> = {
    model,
    max_tokens: config.maxTokens || 2048,
    messages: convoMessages.map(m => ({ role: m.role, content: m.content })),
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    90000
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic chat ошибка ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.content?.[0]?.text || "";
  return {
    content,
    model: data.model || model,
    provider: "anthropic",
    tokenCount: data.usage?.output_tokens,
  };
}

// ---- Google Gemini Adapter ----

async function geminiCheck(config: ProviderConfig): Promise<ProviderCheckResult> {
  if (!config.apiKey || config.apiKey.trim() === "") {
    return {
      ok: false,
      status: "error",
      message: "Gemini: не указан API key. Укажите ключ в настройках.",
    };
  }
  try {
    const model = config.model || "gemini-1.5-flash";
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${config.apiKey}`,
      {},
      8000
    );
    if (res.ok) {
      return { ok: true, status: "available", message: "Gemini API доступен, ключ действителен" };
    }
    if (res.status === 400) {
      // 400 often means invalid key format or bad model name — try listing models
      const listRes = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}`,
        {},
        8000
      );
      if (listRes.ok) {
        return { ok: true, status: "available", message: "Gemini API доступен, ключ действителен" };
      }
    }
    if (res.status === 401 || res.status === 403) {
      const body = await res.json().catch(() => ({}));
      const errMsg = body?.error?.message || "неверный API key";
      return { ok: false, status: "error", message: `Gemini: ${errMsg} (${res.status})`, httpStatus: res.status };
    }
    if (res.status === 429) {
      return { ok: false, status: "error", message: "Gemini: превышен лимит запросов (429)", httpStatus: 429 };
    }
    return {
      ok: false,
      status: "unavailable",
      message: `Gemini API вернул статус ${res.status}`,
      httpStatus: res.status,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, status: "timeout", message: "Gemini API: таймаут подключения (8s)" };
    }
    return { ok: false, status: "error", message: `Gemini: ошибка подключения: ${err.message}` };
  }
}

async function geminiModels(config: ProviderConfig): Promise<string[]> {
  if (!config.apiKey) throw new Error("Gemini: API key не задан");
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}`,
    {},
    10000
  );
  if (!res.ok) {
    // Fall back to known model list
    return [
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
    ];
  }
  const data = await res.json();
  return (data.models || [])
    .map((m: any) => (m.name as string).replace("models/", ""))
    .filter((id: string) => id.startsWith("gemini"));
}

async function geminiChat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  if (!config.apiKey) throw new Error("Gemini: API key не задан");
  const model = config.model || "gemini-1.5-flash";

  // Convert messages to Gemini format
  const contents: any[] = [];
  let systemInstruction: string | null = null;

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = msg.content;
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  const body: Record<string, any> = {
    contents,
    generationConfig: {
      temperature: config.temperature,
      maxOutputTokens: config.maxTokens,
    },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    90000
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini chat ошибка ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return {
    content,
    model,
    provider: "gemini",
    tokenCount: data.usageMetadata?.candidatesTokenCount,
  };
}

// ---- OpenAI-Compatible Adapter ----

async function openaiCompatibleCheck(config: ProviderConfig): Promise<ProviderCheckResult> {
  const base = buildBaseUrl(config);
  const url = `${base}/v1/models`;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    const res = await fetchWithTimeout(url, { headers }, 8000);
    if (res.ok) {
      return { ok: true, status: "available", message: `OpenAI-совместимый сервер доступен (${base})` };
    }
    if (res.status === 401) {
      return { ok: false, status: "error", message: `${base}: неверный API key (401)`, httpStatus: 401 };
    }
    return {
      ok: false,
      status: res.status === 404 ? "unsupported" : "unavailable",
      message: `${base} вернул статус ${res.status}`,
      httpStatus: res.status,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, status: "timeout", message: `OpenAI-совместимый сервер (${base}): таймаут (8s)` };
    }
    const rawMsg = `${err.message || ""} ${(err as any).cause?.code || ""}`;
    const isRefused = /ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(rawMsg);
    return {
      ok: false,
      status: isRefused ? "unavailable" : "error",
      message: `Не удалось подключиться к ${base}: ${err.message}`,
    };
  }
}

async function openaiCompatibleModels(config: ProviderConfig): Promise<string[]> {
  const url = `${buildBaseUrl(config)}/v1/models`;
  const headers: Record<string, string> = {};
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  const res = await fetchWithTimeout(url, { headers }, 10000);
  if (!res.ok) throw new Error(`/v1/models вернул ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m: any) => m.id).filter(Boolean);
}

async function openaiCompatibleChat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  const url = `${buildBaseUrl(config)}/v1/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
      }),
    },
    90000
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI-compatible chat ошибка ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || "",
    model: data.model || config.model,
    provider: "openai_compatible",
    tokenCount: data.usage?.completion_tokens,
  };
}

// ---- MiniMax Adapter ----
//
// MiniMax exposes an OpenAI-compatible API at https://api.minimax.io/v1.
// Auth: Bearer API key (header: Authorization: Bearer <key>).
// Notable models: MiniMax-M2.7, MiniMax-M2.5, abab6.5s-chat.
// listModels falls back to a known model list if the /v1/models endpoint
// returns an error, because MiniMax may restrict that endpoint by plan.

const MINIMAX_BASE_URL = "https://api.minimax.io/v1";

const MINIMAX_KNOWN_MODELS = [
  "MiniMax-M2.7",
  "MiniMax-M2.5",
  "abab6.5s-chat",
  "abab5.5-chat",
];

async function minimaxCheck(config: ProviderConfig): Promise<ProviderCheckResult> {
  if (!config.apiKey || config.apiKey.trim() === "") {
    return {
      ok: false,
      status: "error",
      message: "MiniMax: не указан API key. Укажите ключ в настройках.",
    };
  }
  try {
    const res = await fetchWithTimeout(
      `${MINIMAX_BASE_URL}/models`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
      },
      8000
    );
    if (res.ok) {
      return { ok: true, status: "available", message: "MiniMax API доступен, ключ действителен" };
    }
    if (res.status === 401) {
      return { ok: false, status: "error", message: "MiniMax: неверный API key (401 Unauthorized)", httpStatus: 401 };
    }
    if (res.status === 403) {
      return { ok: false, status: "error", message: "MiniMax: доступ запрещён (403 Forbidden)", httpStatus: 403 };
    }
    if (res.status === 429) {
      return { ok: false, status: "error", message: "MiniMax: превышен лимит запросов (429 Rate Limit)", httpStatus: 429 };
    }
    // Some MiniMax plans block /v1/models — if we get a 4xx that isn't auth,
    // treat the key as potentially valid and tell the user to verify manually.
    if (res.status >= 400 && res.status < 500) {
      return {
        ok: true,
        status: "available",
        message: `MiniMax API отвечает (${res.status}) — ключ принят, список моделей может быть ограничен тарифом`,
        httpStatus: res.status,
      };
    }
    return {
      ok: false,
      status: "unavailable",
      message: `MiniMax API вернул статус ${res.status}`,
      httpStatus: res.status,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { ok: false, status: "timeout", message: "MiniMax API: таймаут подключения (8s)" };
    }
    return { ok: false, status: "error", message: `MiniMax: ошибка подключения: ${err.message}` };
  }
}

async function minimaxModels(config: ProviderConfig): Promise<string[]> {
  if (!config.apiKey) throw new Error("MiniMax: API key не задан");
  try {
    const res = await fetchWithTimeout(
      `${MINIMAX_BASE_URL}/models`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      },
      10000
    );
    if (!res.ok) {
      // Fallback to static known model list when endpoint is inaccessible
      return MINIMAX_KNOWN_MODELS;
    }
    const data = await res.json();
    const ids: string[] = (data.data || []).map((m: any) => m.id as string).filter(Boolean);
    return ids.length > 0 ? ids : MINIMAX_KNOWN_MODELS;
  } catch {
    // On any network failure fall back to the static list so the user
    // can still choose a model name manually.
    return MINIMAX_KNOWN_MODELS;
  }
}

async function minimaxChat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  if (!config.apiKey) throw new Error("MiniMax: API key не задан");
  const model = config.model || "MiniMax-M2.7";
  const res = await fetchWithTimeout(
    `${MINIMAX_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
      }),
    },
    90000
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MiniMax chat ошибка ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || "",
    model: data.model || model,
    provider: "minimax",
    tokenCount: data.usage?.completion_tokens,
  };
}

// ---- Unified Gateway ----

export async function checkProvider(config: ProviderConfig): Promise<ProviderCheckResult> {
  switch (config.providerType) {
    case "ollama":            return ollamaCheck(config);
    case "lmstudio":          return lmstudioCheck(config);
    case "openai":            return openaiCheck(config);
    case "anthropic":         return anthropicCheck(config);
    case "gemini":            return geminiCheck(config);
    case "openai_compatible": return openaiCompatibleCheck(config);
    case "minimax":           return minimaxCheck(config);
    default:
      return { ok: false, status: "unsupported", message: `Неизвестный провайдер: ${config.providerType}` };
  }
}

export async function listModels(config: ProviderConfig): Promise<string[]> {
  switch (config.providerType) {
    case "ollama":            return ollamaModels(config);
    case "lmstudio":          return lmstudioModels(config);
    case "openai":            return openaiModels(config);
    case "anthropic":         return anthropicModels();
    case "gemini":            return geminiModels(config);
    case "openai_compatible": return openaiCompatibleModels(config);
    case "minimax":           return minimaxModels(config);
    default:
      throw new Error(`Неизвестный провайдер: ${config.providerType}`);
  }
}

export async function chat(config: ProviderConfig, messages: ChatMessage[]): Promise<ChatResponse> {
  switch (config.providerType) {
    case "ollama":            return ollamaChat(config, messages);
    case "lmstudio":          return lmstudioChat(config, messages);
    case "openai":            return openaiChat(config, messages);
    case "anthropic":         return anthropicChat(config, messages);
    case "gemini":            return geminiChat(config, messages);
    case "openai_compatible": return openaiCompatibleChat(config, messages);
    case "minimax":           return minimaxChat(config, messages);
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
