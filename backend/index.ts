import "dotenv/config"; // MUST be first import
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { hookRoutes } from "./routes/hook";
import { characterRoutes } from "./routes/character";
import { characterImageRoutes } from "./routes/characterImage";
import { worldRoutes } from "./routes/world";
import { plotRoutes } from "./routes/plot";
import { sceneRoutes } from "./routes/scene";
import { modelRoutes } from "./routes/models";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ── Security & body limits ──────────────────────────────────────────
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
  : undefined; // undefined = allow all (dev mode)

app.use(cors(ALLOWED_ORIGINS ? { origin: ALLOWED_ORIGINS } : undefined));
app.use(express.json({ limit: "2mb" })); // prevent oversized payloads

// ── API routes ──────────────────────────────────────────────────────
app.use("/api/hook", hookRoutes);
app.use("/api/character", characterRoutes);
app.use("/api/character-image", characterImageRoutes);
app.use("/api/world", worldRoutes);
app.use("/api/plot", plotRoutes);
app.use("/api/scene", sceneRoutes);
app.use("/api", modelRoutes);

// ── Global error handler (catches unhandled route/middleware errors) ─
// Cast to `any` because the stub types don't support 4-arg error middleware signature
app.use(((err: Error, _req: unknown, res: { headersSent: boolean; status: (n: number) => any; json: (d: unknown) => void }, _next: unknown) => {
  console.error("UNHANDLED EXPRESS ERROR:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: true, code: "INTERNAL_ERROR", message: "Unexpected server error" });
  }
}) as any);

// ── Serve built frontend in remote/production mode ──────────────────
const distDir = path.resolve(__dirname, "../frontend/dist");
if (existsSync(distDir)) {
  console.log(`Serving frontend from ${distDir}`);
  app.use(express.static(distDir));
  // SPA fallback — send index.html for all non-API routes
  app.get("{*path}", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  console.log("No frontend build found — API-only mode (use Vite dev server for frontend)");
}

const PORT = process.env.PORT ?? 3001;
const server = app.listen(PORT, () => console.log(`Backend running on :${PORT}`));

// ── Graceful shutdown ───────────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down gracefully…`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  // Force exit after 10s if connections don't drain
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Catch truly uncaught errors so the process doesn't crash silently
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
