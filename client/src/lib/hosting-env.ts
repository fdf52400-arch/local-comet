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
