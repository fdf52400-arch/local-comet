import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { probeChromiumAvailable } from "./agent-engine";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // Probe Chromium binary availability at startup so the result is cached
  // before any request arrives. This avoids a cold-probe delay on the first
  // /api/computer/status or /api/computer/run request.
  probeChromiumAvailable().then((available) => {
    log(`Chromium binary: ${available ? "found" : "NOT FOUND (browser tasks will be rejected — run: npx playwright install chromium)"}`, "startup");
  }).catch(() => { /* ignore */ });

  // Log storage mode
  try {
    const { storage, storageMode } = await import("./storage");
    if (storageMode === "memory") {
      log("Storage: in-memory mode (better-sqlite3 unavailable — data resets on restart)", "startup");
      log("  To enable persistence, run: npm rebuild better-sqlite3", "startup");
    } else {
      log("Storage: SQLite (data.db)", "startup");
    }
    // Auto-seed Kwork demo data on first start
    await storage.seedKworkLeads();
  } catch (e) {
    console.error("Kwork seed error:", e);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  // Prefer LOCAL_COMET_PORT, then PORT, default 5051
  const port = parseInt(process.env.LOCAL_COMET_PORT || process.env.PORT || "5051", 10);

  // HOST env var controls the bind address.
  // Defaults to 127.0.0.1 for local/Windows bootstrap (avoids ENOTSUP on SO_REUSEPORT
  // and Windows firewall prompts when binding 0.0.0.0).
  // Set HOST=0.0.0.0 explicitly when you need network-accessible binding (Linux/macOS servers).
  const host = process.env.HOST ?? "127.0.0.1";

  // reusePort is not supported on Windows (causes ENOTSUP). Enable only on platforms
  // where it is available, or when explicitly opted-in via REUSE_PORT=1.
  const isWindows = process.platform === "win32";
  const reusePort = !isWindows || process.env.REUSE_PORT === "1";

  httpServer.listen(
    {
      port,
      host,
      ...(reusePort ? { reusePort: true } : {}),
    },
    () => {
      log(`serving on port ${port} (host: ${host})`);
    },
  );
})();
