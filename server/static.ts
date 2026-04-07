import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve static assets (JS/CSS/images) with long-lived caching — Vite
  // content-hashes the filenames so stale assets are never a problem here.
  app.use(
    express.static(distPath, {
      // Vite fingerprints asset filenames — allow browsers to cache them.
      // index.html is handled separately below with no-cache.
      index: false,
    }),
  );

  // Always serve index.html with no-cache headers so the browser never serves
  // a stale entry point from disk cache.  This is the critical fix for the
  // "old UI from cache" problem on local Windows launch.
  app.use("/{*path}", (_req: Request, res: Response) => {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Surrogate-Control": "no-store",
    });
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
