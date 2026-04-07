import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

/** Shared no-cache headers so index.html is never served from browser cache. */
const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "Surrogate-Control": "no-store",
};

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  const indexHtml = path.resolve(distPath, "index.html");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }
  if (!fs.existsSync(indexHtml)) {
    throw new Error(
      `Could not find index.html in ${distPath}, make sure to build the client first`,
    );
  }

  // Serve static assets (JS/CSS/images) with long-lived caching — Vite
  // content-hashes the filenames so stale assets are never a problem here.
  app.use(
    express.static(distPath, {
      // index.html is handled separately below with no-cache.
      // Do NOT let express.static serve it automatically.
      index: false,
      // Avoid redirect for directories — we want explicit control.
      redirect: false,
    }),
  );

  // Explicit GET / handler — ensures the root URL always returns a fresh
  // index.html without any cache, even when the browser has a stale tab open.
  // This must come before the wildcard catch-all so it short-circuits.
  app.get("/", (_req: Request, res: Response) => {
    res.set(NO_CACHE_HEADERS);
    res.sendFile(indexHtml);
  });

  // Catch-all SPA fallback: all non-asset routes return index.html.
  // Always serve with no-cache headers so the browser never serves
  // a stale entry point from disk cache.
  app.use("/{*path}", (_req: Request, res: Response) => {
    res.set(NO_CACHE_HEADERS);
    res.sendFile(indexHtml);
  });
}
