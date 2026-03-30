import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Ensure hash location for router
if (!window.location.hash || window.location.hash === "#") {
  window.history.replaceState(null, "", window.location.pathname + "#/");
}

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
