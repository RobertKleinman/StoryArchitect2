import "dotenv/config"; // MUST be first import
import express from "express";
import cors from "cors";
import { hookRoutes } from "./routes/hook";
import { modelRoutes } from "./routes/models";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/hook", hookRoutes);
app.use("/api", modelRoutes);

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
