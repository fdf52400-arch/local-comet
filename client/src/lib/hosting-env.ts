/**
 * Hosting environment detection for Local Comet.
 *
 * A "hosted preview" is when the app is served from a public URL (e.g. S3 / CDN)
 * rather than running locally on the user's machine alongside their local models.
 *
 * In hosted-preview mode:
 *   - The server cannot reach localhost on the *user's* machine.
 *   - Ollama / LM Studio connections will always fail.
 *   - Cloud API providers (OpenAI, Anthropic, Gemini) work fine because they
 *     use external HTTPS endpoints.
 *
 * In local mode (npm run dev):
 *   - The server runs on the same machine as Ollama / LM Studio.
 *   - Default Ollama port: 11436 (non-standard to avoid conflicts with system Ollama).
 *   - All local provider checks work as expected.
 *
 * Detection heuristic: if the API_BASE contains a port proxy token (__PORT_XXXX__)
 * that has been replaced with an actual value, the app is deployed to a public host.
 * Otherwise (API_BASE is empty), we assume we're running locally on the same host
 * as the backend.
 */

/**
 * Returns true when the frontend is served from a public hosted preview
 * (i.e. the backend proxy is active), meaning localhost access is impossible.
 */
export function isHostedPreview(): boolean {
  // The template replaces __PORT_5051__ at deploy time with a proxy path.
  // If it has been replaced, we are on a public host.
  const API_BASE = "__PORT_5051__".startsWith("__") ? "" : "__PORT_5051__";
  return API_BASE !== "";
}

/**
 * Returns true when the app is running locally (not a hosted preview).
 * In local mode, Ollama and LM Studio are reachable.
 */
export function isLocalMode(): boolean {
  return !isHostedPreview();
}

/**
 * Returns the mode label for display in the UI.
 */
export function modeBadgeLabel(): string {
  return isHostedPreview() ? "Preview" : "Local";
}

/**
 * Returns a short user-facing description of the current mode.
 */
export function modeDescription(): string {
  if (isHostedPreview()) {
    return "Hosted preview — только облачные API. Ollama и LM Studio недоступны.";
  }
  return "Local mode — доступны Ollama, LM Studio и облачные API.";
}

/**
 * Returns a human-readable note to display when a local provider is selected
 * but the app is running in hosted-preview mode.
 */
export function localProviderHostedNote(): string {
  return (
    "Это публичный preview — сервер не может подключиться к localhost на вашем компьютере. " +
    "Ollama и LM Studio работают только при локальном запуске приложения рядом с моделями. " +
    "Для использования Ollama/LM Studio: запустите приложение локально (npm run dev)."
  );
}

/**
 * Default Ollama endpoint for local mode.
 * Using 11436 (non-standard) to avoid conflicts with system-wide Ollama installation.
 * Using 127.0.0.1 explicitly (loopback) for predictable routing.
 */
export const DEFAULT_OLLAMA_PORT = 11436;
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1";

/**
 * Default LM Studio endpoint for local mode.
 * LM Studio server runs on the local network at the configured IP.
 * Port 1234 is LM Studio's default.
 */
export const DEFAULT_LM_STUDIO_PORT = 1234;
export const DEFAULT_LM_STUDIO_BASE_URL = "http://192.168.31.168";

/**
 * Example LM Studio model name (used as placeholder in UI, not auto-selected).
 */
export const EXAMPLE_LM_STUDIO_MODEL = "google/gemma-3n-e4b";
