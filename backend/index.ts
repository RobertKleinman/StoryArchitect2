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
import v2ProjectRoutes from "./routes/v2/project";
import v2SSERoutes from "./routes/v2/sse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ── Security & body limits ──────────────────────────────────────────
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
  : process.env.NODE_ENV === "production"
    ? ["http://localhost:3000", "http://localhost:3001"] // production default: localhost only
    : undefined; // dev mode: allow all origins

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

// ── v2 pipeline routes ──────────────────────────────────────────────
app.use("/api/v2/project", v2ProjectRoutes);
app.use("/api/v2/project", v2SSERoutes);

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

// ── v2 startup recovery: unstick projects left in 'generating' states ──
import { ProjectStoreV2 } from "./storage/v2/projectStoreV2";

async function recoverStuckProjects() {
  const store = new ProjectStoreV2();
  try {
    const ids = await store.list();
    for (const id of ids) {
      const project = await store.get(id);
      if (!project) continue;
      if (project.step === "premise_generating" || project.step === "bible_generating" || project.step === "scene_generating") {
        console.warn(`[v2] Recovering stuck project ${id} (was ${project.step}) → failed`);
        (project as any).step = "failed";
        (project as any).failedAt = project.step;
        (project as any).error = "Server restarted during generation. Retry to continue.";
        (project as any).recoverySnapshot = JSON.stringify({ step: project.step });
        project.updatedAt = new Date().toISOString();
        await store.save(project);
      }
    }
  } catch (err) {
    console.warn("[v2] Startup recovery scan failed:", err);
  }
}
recoverStuckProjects();

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
