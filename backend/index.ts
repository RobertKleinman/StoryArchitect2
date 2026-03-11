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
app.use(cors());
app.use(express.json());
app.use("/api/hook", hookRoutes);
app.use("/api/character", characterRoutes);
app.use("/api/character-image", characterImageRoutes);
app.use("/api/world", worldRoutes);
app.use("/api/plot", plotRoutes);
app.use("/api/scene", sceneRoutes);
app.use("/api", modelRoutes);

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
app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
