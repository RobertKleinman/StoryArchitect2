/**
 * SSE Connection Hook
 * Opens an EventSource to the v2 SSE endpoint for real-time pipeline progress.
 */

import { useEffect, useRef, useState } from "react";
import type { SSEEvent } from "../../shared/types/apiV2";

interface UseSSEResult {
  lastEvent: SSEEvent | null;
  connected: boolean;
}

export function useSSE(projectId: string | null): UseSSEResult {
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLastEvent(null);
      setConnected(false);
      return;
    }

    function connect() {
      const es = new EventSource(`/api/v2/sse/${projectId}/events`);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data) as SSEEvent;
          setLastEvent(parsed);
        } catch {
          // Ignore non-JSON messages (heartbeats)
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        esRef.current = null;
        // Reconnect after 3s
        retryRef.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      setConnected(false);
    };
  }, [projectId]);

  return { lastEvent, connected };
}
