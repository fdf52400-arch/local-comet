import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Ensure hash location for router
if (!window.location.hash || window.location.hash === "#") {
  window.history.replaceState(null, "", window.location.pathname + "#/");
}

const root = document.getElementById("root");
if (root) {
  try {
    createRoot(root).render(<App />);
  } catch (err) {
    root.innerHTML = `<div style="padding:2rem;color:#ef4444;font-family:monospace"><h2>Local Comet: render error</h2><pre>${String(err)}</pre></div>`;
  }
} else {
  document.body.innerHTML = `<div style="padding:2rem;color:#ef4444;font-family:monospace">Missing #root element</div>`;
}
