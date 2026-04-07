import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Hash-location bootstrap ──────────────────────────────────────────────────
// Guarantee the router always starts on "/#/" regardless of how the browser
// opened the page (plain root, query-param cache-bust, or explicit hash).
// Guard: only touch the URL if we are on a real http(s) origin — avoids
// no-op replaceState calls when the page is somehow loaded as about:blank.
if (window.location.protocol === "http:" || window.location.protocol === "https:") {
  const hash = window.location.hash;
  if (!hash || hash === "#") {
    // Preserve any query string (e.g. ?v=cachebust) and append #/
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + "#/",
    );
  }
}

// ── React mount ──────────────────────────────────────────────────────────────
const root = document.getElementById("root");
const boot = document.getElementById("boot-screen");
if (root) {
  try {
    if (boot) boot.style.display = "none";
    createRoot(root).render(<App />);
  } catch (err) {
    if (boot) boot.style.display = "none";
    root.innerHTML = `<div style="min-height:100vh;padding:2rem;background:#0b0d12;color:#ef4444;font-family:monospace"><h2>Local Comet: render error</h2><pre style="white-space:pre-wrap">${String(err)}</pre></div>`;
  }
} else {
  document.body.innerHTML = `<div style="min-height:100vh;padding:2rem;background:#0b0d12;color:#ef4444;font-family:monospace">Missing #root element</div>`;
}
