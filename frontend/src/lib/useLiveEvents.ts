'use client';

import { useEffect, useRef } from 'react';
import { getToken } from './auth';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const DEBOUNCE_MS = 200;

export interface LiveEvent {
  type: string;
  projectId: string | null;
  entityId?: string;
}

/**
 * Subscribes to the backend SSE stream and calls `onEvent` (debounced) when
 * data changes, so views can reload without a manual refresh. Pass a
 * projectId to receive only that project's events, or null for all events.
 * No-op without a token or EventSource support (e.g. jsdom tests).
 */
export function useLiveEvents(projectId: string | null, onEvent: (event: LiveEvent) => void) {
  const callbackRef = useRef(onEvent);
  useEffect(() => {
    callbackRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const token = getToken();
    if (!token) return;

    const params = new URLSearchParams({ token });
    if (projectId) params.set('projectId', projectId);
    const source = new EventSource(`${BASE}/api/v1/events?${params.toString()}`);

    let timer: ReturnType<typeof setTimeout> | null = null;
    source.onmessage = (message) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => callbackRef.current(event), DEBOUNCE_MS);
    };

    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [projectId]);
}
