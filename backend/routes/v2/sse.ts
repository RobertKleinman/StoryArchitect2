/**
 * v2 SSE Route — Server-Sent Events for batch progress
 */

import { Router } from "express";
import { getProjectEmitter } from "../../services/v2/progressEmitter";
import type { SSEEvent } from "../../../shared/types/apiV2";

const router = Router();

router.get("/:projectId/events", (req, res) => {
  const { projectId } = req.params;

  // Cast to Node.js ServerResponse for SSE methods
  const raw = res as any;
  raw.setHeader("Content-Type", "text/event-stream");
  raw.setHeader("Cache-Control", "no-cache");
  raw.setHeader("Connection", "keep-alive");
  raw.setHeader("X-Accel-Buffering", "no");
  raw.flushHeaders();

  const emitter = getProjectEmitter(projectId);

  const onEvent = (event: SSEEvent) => {
    raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  emitter.on("sse", onEvent);

  // Send heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    raw.write(": heartbeat\n\n");
  }, 30_000);

  (req as any).on("close", () => {
    emitter.off("sse", onEvent);
    clearInterval(heartbeat);
  });
});

export default router;
